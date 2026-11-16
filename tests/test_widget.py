"""Behavior of the Python Auth widget."""

import pytest

from ipyauth_pkce import Auth, ParamsAuth0, ParamsGoogle, ParamsKeycloak

REDIRECT = 'http://localhost:8888/callback/'

PARAMS = {
    'google': lambda: ParamsGoogle(client_id='gid', redirect_uri=REDIRECT, scope='openid profile'),
    'keycloak': lambda: ParamsKeycloak(
        base_url='https://kc.example.com', realm='r', client_id='kid',
        redirect_uri=REDIRECT, scope='openid profile',
    ),
    'auth0': lambda: ParamsAuth0(
        domain='t.auth0.com', client_id='aid', redirect_uri=REDIRECT, scope='openid profile',
    ),
}


def _descendants(widget):
    for child in getattr(widget, 'children', ()):
        yield child
        yield from _descendants(child)


@pytest.mark.parametrize('provider', PARAMS)
def test_auth_widget_builds_for_each_provider(provider):
    params = PARAMS[provider]()
    auth = Auth(params=params)

    assert auth.name == provider
    assert auth.params == params.data

    widgets = list(_descendants(auth))
    classes = {c for w in widgets for c in w._dom_classes}
    # Role classes the frontend resolves its child views by (widget_box.js).
    assert {
        'ipyauth-btn-main', 'ipyauth-logged-as', 'ipyauth-time-to-exp',
        'ipyauth-expires-at', 'ipyauth-error',
    } <= classes

    logo = next(w for w in widgets if w.__class__.__name__ == 'Image')
    assert bytes(logo.value).startswith(b'\x89PNG')


def _logo_widget(auth):
    return next(
        w for w in _descendants(auth) if w.__class__.__name__ == 'Image'
    )


def test_logo_override_from_bytes():
    custom = b'\x89PNG\r\n\x1a\ncompany-logo'
    auth = Auth(params=PARAMS['keycloak'](), logo=custom)
    logo = _logo_widget(auth)
    assert bytes(logo.value) == custom
    assert logo.format == 'png'


def test_logo_override_from_path(tmp_path):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    path = tmp_path / 'company.svg'
    path.write_bytes(svg)
    auth = Auth(params=PARAMS['keycloak'](), logo=str(path))
    logo = _logo_widget(auth)
    assert bytes(logo.value) == svg
    assert logo.format == 'svg+xml'


def test_logo_defaults_to_provider_logo():
    auth = Auth(params=PARAMS['keycloak']())
    logo = _logo_widget(auth)
    assert bytes(logo.value).startswith(b'\x89PNG')
    assert logo.format == 'png'


@pytest.mark.parametrize('bad', [None, {}, {'name': 'google', 'url_params': {}}, object()])
def test_auth_rejects_non_params_objects(bad):
    with pytest.raises(TypeError):
        Auth(params=bad)


def test_session_helpers():
    auth = Auth(params=PARAMS['google']())
    assert not auth.is_authenticated
    assert auth.headers == {}
    assert repr(auth) == "Auth(provider='google', status='not authenticated')"

    auth.access_token = 'tok'
    auth.logged_as = 'Jane'
    auth.expires_at = 'later'
    assert auth.is_authenticated
    assert auth.headers == {'Authorization': 'Bearer tok'}
    assert repr(auth) == "Auth(provider='google', user='Jane', expires='later')"


def test_clear_signals_frontend():
    auth = Auth(params=PARAMS['google']())
    before = auth._incr_signout
    auth.clear()
    assert auth._incr_signout == before + 1


def _frontend_msg(auth, content):
    auth._handle_msg({'content': {'data': {'method': 'custom', 'content': content}}, 'buffers': []})


def test_tokens_arrive_via_custom_message():
    auth = Auth(params=PARAMS['keycloak']())
    _frontend_msg(auth, {'event': 'tokens', 'access_token': 'at', 'refresh_token': 'rt'})
    assert auth.access_token == 'at'
    assert auth.refresh_token == 'rt'
    assert auth.is_authenticated

    _frontend_msg(auth, {'event': 'tokens', 'access_token': '', 'refresh_token': ''})
    assert auth.access_token == ''
    assert auth.refresh_token == ''
    assert not auth.is_authenticated


@pytest.mark.parametrize('content', [
    {'event': 'other', 'access_token': 'at'},
    {'event': 'tokens', 'access_token': 1, 'refresh_token': 'rt'},
    {'event': 'tokens', 'access_token': 'at', 'refresh_token': None},
    'tokens',
])
def test_unexpected_custom_messages_are_ignored(content):
    auth = Auth(params=PARAMS['keycloak']())
    _frontend_msg(auth, {'event': 'tokens', 'access_token': 'at', 'refresh_token': 'rt'})
    _frontend_msg(auth, content)
    assert auth.access_token == 'at'
    assert auth.refresh_token == 'rt'


def test_clear_drops_tokens():
    auth = Auth(params=PARAMS['keycloak']())
    _frontend_msg(auth, {'event': 'tokens', 'access_token': 'at', 'refresh_token': 'rt'})
    auth.clear()
    assert auth.access_token == ''
    assert auth.refresh_token == ''


def test_tokens_are_not_in_widget_state():
    auth = Auth(params=PARAMS['keycloak']())
    _frontend_msg(auth, {'event': 'tokens', 'access_token': 'at', 'refresh_token': 'rt'})
    state = auth.get_state()
    assert 'access_token' not in state
    assert 'refresh_token' not in state
