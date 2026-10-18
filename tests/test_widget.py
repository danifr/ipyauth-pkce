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
