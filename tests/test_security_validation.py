"""Quick smoke tests for the security validation helpers."""

import re
import sys
import os

# Add project root to path so we can import the module directly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ipyauth_pkce.ipyauth_callback.server_extension import (
    _CODE_VERIFIER_RE,
    _resolve_token_endpoint,
    _is_valid_https_url,
    _sanitize_log_value,
    _validate_token_exchange_body,
)


def test_sanitize_log_value_strips_control_chars():
    assert _sanitize_log_value('a\nb\r\x1b[31mc\x00\x7f\x9fd/e.f') == 'ab[31mcd/e.f'
    assert _sanitize_log_value('plain/path-1.js') == 'plain/path-1.js'


def test_valid_https_urls():
    assert _is_valid_https_url('https://accounts.google.com/o/oauth2/token')
    assert _is_valid_https_url('https://login.microsoftonline.com/token')
    assert _is_valid_https_url('https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token')


def test_rejects_non_https():
    assert not _is_valid_https_url('http://evil.com/token')
    assert not _is_valid_https_url('ftp://evil.com/token')
    assert not _is_valid_https_url('file:///etc/passwd')


def test_rejects_loopback():
    # Localhost is allowed for local dev (e.g. local Keycloak)
    assert _is_valid_https_url('http://localhost:8080/realms/test/protocol/openid-connect/token')
    assert _is_valid_https_url('https://localhost/token')
    assert _is_valid_https_url('http://127.0.0.1:8080/token')
    # But not with weird schemes
    assert not _is_valid_https_url('ftp://localhost/token')


def test_rejects_metadata_endpoints():
    assert not _is_valid_https_url('https://169.254.169.254/latest/meta-data')
    assert not _is_valid_https_url('https://metadata.google.internal/computeMetadata')


def test_rejects_empty_and_garbage():
    assert not _is_valid_https_url('')
    assert not _is_valid_https_url('not-a-url')
    assert not _is_valid_https_url('://missing-scheme')


def test_code_verifier_valid():
    assert _CODE_VERIFIER_RE.match('a' * 43)   # min length
    assert _CODE_VERIFIER_RE.match('a' * 128)  # max length
    assert _CODE_VERIFIER_RE.match('abcABC012-._~' + 'x' * 30)  # valid chars


def test_code_verifier_invalid():
    assert not _CODE_VERIFIER_RE.match('a' * 42)   # too short
    assert not _CODE_VERIFIER_RE.match('a' * 129)  # too long
    assert not _CODE_VERIFIER_RE.match('a' * 43 + ' ')  # space not allowed


def test_google_token_endpoint_allowed_without_configuration(monkeypatch):
    monkeypatch.delenv('IPYAUTH_TOKEN_ENDPOINT', raising=False)
    endpoint, error = _resolve_token_endpoint('https://oauth2.googleapis.com/token')
    assert error is None
    assert endpoint == 'https://oauth2.googleapis.com/token'


def test_non_google_endpoint_rejected_when_unconfigured(monkeypatch):
    monkeypatch.delenv('IPYAUTH_TOKEN_ENDPOINT', raising=False)
    for candidate in (
        'https://evil.example/token',
        'https://accounts.google.com/o/oauth2/token',
        'https://keycloak.example.com/realms/r/protocol/openid-connect/token',
    ):
        endpoint, error = _resolve_token_endpoint(candidate)
        assert endpoint is None
        assert error[0] == 400
        assert 'IPYAUTH_TOKEN_ENDPOINT' in error[1]


def test_configured_endpoint_takes_precedence_and_ignores_browser(monkeypatch):
    configured = 'https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token'
    monkeypatch.setenv('IPYAUTH_TOKEN_ENDPOINT', configured)

    # Whatever the browser sends, the server uses its own configured endpoint.
    for browser_value in (
        configured,
        'https://oauth2.googleapis.com/token',
        'https://attacker.example/token',
        '',
    ):
        endpoint, error = _resolve_token_endpoint(browser_value)
        assert error is None
        assert endpoint == configured


def test_configured_endpoint_is_normalized(monkeypatch):
    # Trailing whitespace and host casing are normalized to a canonical form.
    monkeypatch.setenv(
        'IPYAUTH_TOKEN_ENDPOINT',
        '  https://Keycloak.Example.COM/realms/r/protocol/openid-connect/token  ',
    )
    endpoint, error = _resolve_token_endpoint('https://oauth2.googleapis.com/token')
    assert error is None
    assert endpoint == 'https://keycloak.example.com/realms/r/protocol/openid-connect/token'


def test_configured_localhost_endpoint_allowed_for_dev(monkeypatch):
    configured = 'http://localhost:8080/realms/test/protocol/openid-connect/token'
    monkeypatch.setenv('IPYAUTH_TOKEN_ENDPOINT', configured)
    endpoint, error = _resolve_token_endpoint('https://oauth2.googleapis.com/token')
    assert error is None
    assert endpoint == configured


def test_blank_configuration_is_treated_as_unset(monkeypatch):
    monkeypatch.setenv('IPYAUTH_TOKEN_ENDPOINT', '   ')
    # Falls back to the Google-only default behavior.
    endpoint, error = _resolve_token_endpoint('https://oauth2.googleapis.com/token')
    assert error is None
    assert endpoint == 'https://oauth2.googleapis.com/token'
    endpoint, error = _resolve_token_endpoint('https://evil.example/token')
    assert endpoint is None
    assert error[0] == 400


def test_misconfigured_endpoint_is_server_error(monkeypatch):
    # Unsafe / malformed configured values are the operator's fault -> 500.
    for bad in (
        'https://user:pass@keycloak.example.com/token',   # credentials
        'https://keycloak.example.com/token?x=1',         # query string
        'https://keycloak.example.com/token#frag',        # fragment
        'http://keycloak.example.com/token',              # non-localhost http
        'https://169.254.169.254/token',                 # metadata address
        'https://10.0.0.1/token',                        # private IP
        'not-a-url',
    ):
        monkeypatch.setenv('IPYAUTH_TOKEN_ENDPOINT', bad)
        endpoint, error = _resolve_token_endpoint('https://oauth2.googleapis.com/token')
        assert endpoint is None, bad
        assert error[0] == 500, bad
        # Must not echo the raw configured value back.
        assert bad not in error[1], bad


def test_token_exchange_body_pins_configured_endpoint(monkeypatch):
    configured = 'https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token'
    monkeypatch.setenv('IPYAUTH_TOKEN_ENDPOINT', configured)
    body = {
        'code': 'authorization-code',
        'code_verifier': 'a' * 43,
        'redirect_uri': 'http://localhost:8888/callback/',
        # Browser tries to redirect the code elsewhere; server must ignore it.
        'token_endpoint': 'https://attacker.example/token',
        'client_id': 'client-id',
    }
    fields, error = _validate_token_exchange_body(body)
    assert error is None
    assert fields['token_endpoint'] == configured


def test_token_exchange_body_rejects_unconfigured_non_google(monkeypatch):
    monkeypatch.delenv('IPYAUTH_TOKEN_ENDPOINT', raising=False)
    body = {
        'code': 'authorization-code',
        'code_verifier': 'a' * 43,
        'redirect_uri': 'http://localhost:8888/callback/',
        'token_endpoint': 'https://keycloak.example.com/realms/r/protocol/openid-connect/token',
        'client_id': 'client-id',
    }
    fields, error = _validate_token_exchange_body(body)
    assert fields is None
    assert error[0] == 400
    assert 'IPYAUTH_TOKEN_ENDPOINT' in error[1]


def test_token_exchange_body_allows_google_without_configuration(monkeypatch):
    monkeypatch.delenv('IPYAUTH_TOKEN_ENDPOINT', raising=False)
    body = {
        'code': 'authorization-code',
        'code_verifier': 'a' * 43,
        'redirect_uri': 'http://localhost:8888/callback/',
        'token_endpoint': 'https://oauth2.googleapis.com/token',
        'client_id': 'client-id',
    }
    fields, error = _validate_token_exchange_body(body)
    assert error is None
    assert fields['token_endpoint'] == 'https://oauth2.googleapis.com/token'


def _exchange_body(redirect_uri):
    return {
        'code': 'authorization-code',
        'code_verifier': 'a' * 43,
        'redirect_uri': redirect_uri,
        'token_endpoint': 'https://oauth2.googleapis.com/token',
        'client_id': 'client-id',
    }


def test_redirect_uri_rules(monkeypatch):
    monkeypatch.delenv('IPYAUTH_TOKEN_ENDPOINT', raising=False)
    for ok in (
        'https://hub.example.com/user/x/callback/',
        'http://localhost:8888/callback/',
        'http://127.0.0.1:8888/callback/',
        'http://[::1]:8888/callback/',
    ):
        fields, error = _validate_token_exchange_body(_exchange_body(ok))
        assert error is None, ok
    for bad in (
        'http://hub.example.com/callback/',
        'ftp://localhost/callback/',
        'javascript:alert(1)',
        'http://[::1/callback/',
        '',
    ):
        fields, error = _validate_token_exchange_body(_exchange_body(bad))
        assert fields is None, bad
        assert error[0] == 400, bad
