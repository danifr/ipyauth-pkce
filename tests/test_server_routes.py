"""HTTP-level tests for the callback server extension against a real Jupyter server."""

import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'ipyauth_pkce', 'ipyauth_callback', 'templates')
TOKEN = 'test-token'


def _free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class _FakeIdP(http.server.BaseHTTPRequestHandler):
    """Token endpoint stub: behavior is chosen by the posted authorization code."""

    received = []

    def do_POST(self):
        form = urllib.parse.parse_qs(self.rfile.read(int(self.headers['Content-Length'])).decode())
        _FakeIdP.received.append({k: v[0] for k, v in form.items()})
        code = form['code'][0]
        if code == 'drop':
            return  # close without a response -> network error
        status, body = (200, {'access_token': 'at', 'id_token': 'x.y.z'}) if code == 'good' else (
            400, {'error': 'invalid_grant'})
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


@pytest.fixture(scope='module')
def idp():
    httpd = http.server.HTTPServer(('127.0.0.1', 0), _FakeIdP)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f'http://localhost:{httpd.server_port}/token'
    httpd.shutdown()


@pytest.fixture(scope='module')
def server(tmp_path_factory, idp):
    port = _free_port()
    env = dict(os.environ, PYTHONPATH=ROOT, JUPYTER_CONFIG_DIR=str(tmp_path_factory.mktemp('cfg')))
    env['IPYAUTH_TOKEN_ENDPOINT'] = idp
    proc = subprocess.Popen(
        [
            sys.executable, '-m', 'jupyter_server',
            f'--port={port}', '--ip=127.0.0.1', '--no-browser',
            f'--IdentityProvider.token={TOKEN}',
            '--ServerApp.jpserver_extensions={"ipyauth_pkce.ipyauth_callback.server_extension": True}',
            f'--ServerApp.root_dir={tmp_path_factory.mktemp("root")}',
        ],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f'http://127.0.0.1:{port}'
    for _ in range(100):
        try:
            urllib.request.urlopen(f'{base}/api/status?token={TOKEN}', timeout=1)
            break
        except (urllib.error.URLError, ConnectionError):
            time.sleep(0.1)
    else:
        proc.kill()
        pytest.fail('jupyter server did not start')
    yield base
    proc.terminate()
    proc.wait(timeout=10)


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def _file(*parts):
    with open(os.path.join(ASSETS, *parts), 'rb') as f:
        return f.read()


@pytest.mark.parametrize('path', ['/callback', '/callback/', '/callback.html', '/callback/?code=x&state=y'])
def test_callback_page_is_public_and_verbatim(server, path):
    status, headers, body = _get(server + path)
    assert status == 200
    assert headers['Content-Type'].startswith('text/html')
    assert headers['X-Frame-Options'] == 'SAMEORIGIN'
    assert body == _file('index.html')


@pytest.mark.parametrize('prefix', ['/callback/assets/', '/assets/'])
@pytest.mark.parametrize('name', ['main.js', 'util.js'])
def test_callback_assets_are_public_and_verbatim(server, prefix, name):
    status, headers, body = _get(server + prefix + name)
    assert status == 200
    assert headers['Content-Type'].startswith('application/javascript')
    assert body == _file('assets', name)


@pytest.mark.parametrize('name', ['index.html', '../server_extension.py', 'other.js'])
def test_unknown_assets_are_404(server, name):
    status, _, _ = _get(server + '/callback/assets/' + name)
    assert status == 404


def _post_exchange(server, body, token=TOKEN):
    req = urllib.request.Request(
        f'{server}/callback/token-exchange',
        data=json.dumps(body).encode() if not isinstance(body, bytes) else body,
        headers={'Content-Type': 'application/json', 'Authorization': f'token {token}'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_token_exchange_requires_jupyter_auth(server):
    status, _ = _post_exchange(server, {}, token='wrong')
    assert status == 403


def test_token_exchange_rejects_invalid_json(server):
    status, body = _post_exchange(server, b'not json')
    assert status == 400
    assert json.loads(body)['error_description'] == 'Invalid JSON body'


def _exchange_body(code):
    return {
        'code': code, 'code_verifier': 'v' * 43, 'client_id': 'cid',
        'redirect_uri': 'http://localhost:8888/callback/',
        # Ignored: the server always uses its configured endpoint.
        'token_endpoint': 'https://attacker.example/token',
    }


def test_token_exchange_success_posts_to_configured_endpoint(server):
    _FakeIdP.received.clear()
    status, body = _post_exchange(server, _exchange_body('good'))
    assert status == 200
    assert json.loads(body) == {'access_token': 'at', 'id_token': 'x.y.z'}
    assert _FakeIdP.received == [{
        'grant_type': 'authorization_code', 'code': 'good', 'code_verifier': 'v' * 43,
        'client_id': 'cid', 'redirect_uri': 'http://localhost:8888/callback/',
    }]


def test_token_exchange_forwards_idp_error_as_400(server):
    status, body = _post_exchange(server, _exchange_body('bad'))
    assert status == 400
    assert json.loads(body) == {'error': 'invalid_grant'}


def test_token_exchange_network_error_is_generic_502(server):
    status, body = _post_exchange(server, _exchange_body('drop'))
    assert status == 502
    assert json.loads(body) == {'error': 'bad_gateway', 'error_description': 'Token exchange failed'}


def test_token_exchange_validates_body(server):
    body = _exchange_body('good')
    body['code_verifier'] = 'short'
    status, resp = _post_exchange(server, body)
    assert status == 400
    assert 'RFC 7636' in json.loads(resp)['error_description']
