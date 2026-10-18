
import ipaddress
import json
import os
import re
import urllib.parse

import tornado.httpclient
import tornado.web
from jupyter_server.base.handlers import JupyterHandler, allow_unauthenticated
from jupyter_server.utils import url_path_join


# RFC 7636: code_verifier is 43-128 chars of [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
_CODE_VERIFIER_RE = re.compile(r'^[A-Za-z0-9\-._~]{43,128}$')

# Maximum length for string fields to prevent abuse
_MAX_FIELD_LENGTH = 2048

# Hosts for which plain http is acceptable (local development).
_LOCALHOST_HOSTS = ('localhost', '127.0.0.1', '::1')

# The browser supplies a token endpoint derived from the notebook's provider
# configuration, but the server never blindly trusts it: the authorization code
# and PKCE verifier must only ever be sent to an endpoint the server operator
# vouches for. Google's endpoint is fixed and allowed by default. For any other
# provider (Keycloak, Auth0, other OIDC, local development), the operator sets
# IPYAUTH_TOKEN_ENDPOINT on the Jupyter server; when set, that value is
# authoritative and the browser-supplied endpoint is ignored.
_GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
_TOKEN_ENDPOINT_ENV = 'IPYAUTH_TOKEN_ENDPOINT'

_TOKEN_ENDPOINT_NOT_CONFIGURED_MSG = (
    'Token exchange endpoint not configured. Set the IPYAUTH_TOKEN_ENDPOINT '
    'environment variable on the Jupyter server to your provider\'s token '
    'endpoint (for example '
    'https://your-provider/realms/your-realm/protocol/openid-connect/token). '
    'Google\'s endpoint is allowed without configuration.'
)
_TOKEN_ENDPOINT_MISCONFIGURED_MSG = (
    'Server misconfiguration: IPYAUTH_TOKEN_ENDPOINT is set to an invalid or '
    'unsafe token endpoint. It must be an HTTPS URL (http is allowed only for '
    'localhost) with no credentials, query string, or fragment.'
)


def _sanitize_log_value(value):
    """Strip C0/C1 control characters to prevent log injection."""
    return re.sub(r'[\x00-\x1f\x7f-\x9f]', '', value)


def _is_valid_https_url(url):
    """Validate that a URL uses HTTPS and has no private/loopback host.

    Localhost is allowed (for local development with e.g. Keycloak),
    but only over http or https — not other schemes.
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False

    host = parsed.hostname
    if not host:
        return False

    # Allow localhost for local development (http or https)
    if host in _LOCALHOST_HOSTS:
        return parsed.scheme in ('http', 'https')

    # Non-localhost must be HTTPS
    if parsed.scheme != 'https':
        return False

    # Block cloud metadata endpoints
    blocked = ('169.254.169.254', 'metadata.google.internal')
    if host in blocked:
        return False

    # Block private IP ranges (10.x, 172.16-31.x, 192.168.x)
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local:
            return False
    except ValueError:
        pass  # Not an IP literal — hostname is fine

    return True


def _normalize_token_endpoint(url):
    """Return a canonical endpoint URL or ``None`` when it is unsafe.

    Token endpoints are exact allowlist entries, so credentials and URL
    components that could change the request target are never accepted.
    """
    if not isinstance(url, str) or not url or url != url.strip():
        return None

    try:
        parsed = urllib.parse.urlsplit(url)
        # Accessing .port also validates malformed port values.
        port = parsed.port
    except (ValueError, TypeError):
        return None

    if (
        parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or not parsed.hostname
        or not _is_valid_https_url(url)
    ):
        return None

    hostname = parsed.hostname.lower()
    if ':' in hostname:
        netloc = f'[{hostname}]'
    else:
        netloc = hostname
    if port is not None:
        netloc += f':{port}'

    return urllib.parse.urlunsplit((parsed.scheme.lower(), netloc, parsed.path, '', ''))


def _get_configured_token_endpoint():
    """Return the operator-configured token endpoint, or ``None`` if unset.

    Reads IPYAUTH_TOKEN_ENDPOINT from the server environment. Blank/whitespace
    values are treated as unset.
    """
    return os.environ.get(_TOKEN_ENDPOINT_ENV, '').strip() or None


def _resolve_token_endpoint(browser_supplied):
    """Decide which token endpoint the server will POST the code to.

    Precedence:
      1. If IPYAUTH_TOKEN_ENDPOINT is configured, use it (the browser-supplied
         value is ignored). A misconfigured value is a server error.
      2. Otherwise, allow the built-in Google endpoint if the browser supplied
         exactly that.
      3. Otherwise, reject with an actionable "not configured" error.

    Returns (endpoint, None) on success or (None, (status, error_json)) on
    failure. The returned endpoint has already passed the SSRF/normalization
    checks in ``_normalize_token_endpoint``.
    """
    configured = _get_configured_token_endpoint()
    if configured is not None:
        normalized = _normalize_token_endpoint(configured)
        if normalized is None:
            # The operator set an invalid/unsafe endpoint — 500, not the
            # client's fault. Do not echo the raw value back.
            return None, (500, _make_error(_TOKEN_ENDPOINT_MISCONFIGURED_MSG))
        return normalized, None

    # No server configuration: only the fixed, well-known Google endpoint is
    # accepted without an explicit setting.
    normalized = _normalize_token_endpoint(browser_supplied)
    if normalized is not None and normalized == _GOOGLE_TOKEN_ENDPOINT:
        return normalized, None

    return None, (400, _make_error(_TOKEN_ENDPOINT_NOT_CONFIGURED_MSG))


def _make_error(error_description):
    """Build a JSON error response body."""
    return json.dumps({'error': 'invalid_request', 'error_description': error_description})


def _validate_token_exchange_body(body):
    """Validate the token exchange request body.

    Returns (fields_dict, None) on success or (None, (status, error_json)) on failure.
    """
    required_fields = ['code', 'code_verifier', 'redirect_uri', 'token_endpoint', 'client_id']
    for field in required_fields:
        if field not in body:
            return None, (400, _make_error(f'Missing required field: {field}'))

    # Validate field types and lengths
    for field in required_fields:
        if not isinstance(body[field], str) or len(body[field]) > _MAX_FIELD_LENGTH:
            return None, (400, _make_error(f'Invalid value for field: {field}'))

    token_endpoint = body['token_endpoint']
    redirect_uri = body['redirect_uri']
    code_verifier = body['code_verifier']

    # Decide the token endpoint server-side. The browser-supplied value is only
    # honored when it is the built-in Google endpoint; otherwise the operator
    # must configure IPYAUTH_TOKEN_ENDPOINT, which then takes precedence.
    resolved_endpoint, endpoint_error = _resolve_token_endpoint(token_endpoint)
    if endpoint_error:
        return None, endpoint_error

    # Validate redirect_uri: https, or http only for localhost.
    try:
        redir_parsed = urllib.parse.urlparse(redirect_uri)
        redir_host = redir_parsed.hostname
    except ValueError:
        redir_parsed, redir_host = None, None
    if redir_parsed is None or not (
        redir_parsed.scheme == 'https'
        or (redir_parsed.scheme == 'http' and redir_host in _LOCALHOST_HOSTS)
    ):
        return None, (400, _make_error('redirect_uri must be HTTPS (or http://localhost for development)'))

    # Validate code_verifier format per RFC 7636
    if not _CODE_VERIFIER_RE.match(code_verifier):
        return None, (400, _make_error('code_verifier does not match RFC 7636 format'))

    fields = {f: body[f] for f in required_fields}
    # Pin the server-resolved endpoint so the exchange always targets a trusted
    # URL, never the raw browser-supplied value.
    fields['token_endpoint'] = resolved_endpoint
    return fields, None


_BAD_GATEWAY = json.dumps({'error': 'bad_gateway', 'error_description': 'Token exchange failed'})


class TokenExchangeHandler(JupyterHandler):
    """Exchanges an authorization code for tokens server-side (PKCE flow)."""

    def _write_json(self, status, body):
        self.set_status(status)
        self.set_header('Content-Type', 'application/json')
        self.write(body)

    @tornado.web.authenticated
    async def post(self):
        try:
            body = json.loads(self.request.body)
        except (json.JSONDecodeError, TypeError):
            self._write_json(400, _make_error('Invalid JSON body'))
            return

        fields, error = _validate_token_exchange_body(body)
        if error:
            self._write_json(*error)
            return

        payload = {
            'grant_type': 'authorization_code',
            'code': fields['code'],
            'code_verifier': fields['code_verifier'],
            'client_id': fields['client_id'],
            'redirect_uri': fields['redirect_uri'],
        }

        http_client = tornado.httpclient.AsyncHTTPClient()
        try:
            response = await http_client.fetch(
                fields['token_endpoint'],
                method='POST',
                body=urllib.parse.urlencode(payload),
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
            )
            self._write_json(200, response.body)
        except tornado.httpclient.HTTPClientError as e:
            if e.response and e.response.body:
                # IdP returned an error response — forward it as 400
                self._write_json(400, e.response.body)
            else:
                # Network / connection error — 502
                self.log.exception('Token exchange network error')
                self._write_json(502, _BAD_GATEWAY)
        except Exception:
            self.log.exception('Token exchange error')
            self._write_json(502, _BAD_GATEWAY)


# Static callback files, served verbatim. The whitelist prevents path traversal.
_TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), 'templates')
_ALLOWED_ASSETS = {'main.js', 'util.js'}


def _read_static(*parts):
    with open(os.path.join(_TEMPLATES_DIR, *parts), 'rb') as f:
        return f.read()


class CallbackHandler(JupyterHandler):
    """Serves the OAuth callback HTML page.

    Unauthenticated: this is the OAuth redirect target — the IdP redirects
    the user here after login, so Jupyter auth must not gate access.
    """

    @allow_unauthenticated
    def get(self, path):
        self.log.info('in CallbackHandler with path=%s', _sanitize_log_value(path))
        self.set_header('Content-Type', 'text/html')
        self.set_header('Content-Security-Policy', "frame-ancestors 'self'")
        self.set_header('X-Frame-Options', 'SAMEORIGIN')
        self.write(_read_static('index.html'))


class CallbackAssetsHandler(JupyterHandler):
    """Serves JS assets for the callback page.

    Unauthenticated: these assets are loaded by the OAuth callback page,
    which itself must be accessible without Jupyter auth.
    """

    @allow_unauthenticated
    def get(self, path):
        if path not in _ALLOWED_ASSETS:
            self.set_status(404)
            return
        self.log.info('in CallbackAssetsHandler with path=%s', _sanitize_log_value(path))
        self.set_header('Content-Type', 'application/javascript')
        self.write(_read_static('assets', path))


def _load_jupyter_server_extension(nb_app):
    web_app = nb_app.web_app
    base_url = web_app.settings['base_url']

    # '/callback(.*)' also matches '/callback.html'. The root '/assets/' route is
    # needed when the redirect_uri has no trailing slash ('/callback'), because
    # index.html loads its scripts via relative 'assets/...' URLs.
    web_app.add_handlers(
        '.*$',
        [(url_path_join(base_url, '/callback/token-exchange'), TokenExchangeHandler),
         (url_path_join(base_url, '/callback/assets/(.*)'), CallbackAssetsHandler),
         (url_path_join(base_url, '/assets/(.*)'), CallbackAssetsHandler),
         (url_path_join(base_url, '/callback(.*)'), CallbackHandler),
         ]
    )

    nb_app.log.info("ipyauth callback server extension enabled")
