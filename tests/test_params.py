"""Behavior of the provider parameter classes (ParamsAuth0/Google/Keycloak)."""

import pytest
from traitlets import TraitError

from ipyauth_pkce import ParamsAuth0, ParamsGoogle, ParamsKeycloak

R = 'http://localhost:8888/callback/'

# Minimal valid configuration for each provider.
VALID = {
    ParamsGoogle: dict(client_id='g', redirect_uri=R, scope='openid profile'),
    ParamsKeycloak: dict(base_url='https://kc.example.com', realm='r', client_id='k',
                         redirect_uri=R, scope='openid profile'),
    ParamsAuth0: dict(domain='t.auth0.com', client_id='a', redirect_uri=R, scope='openid profile'),
}
PROVIDERS = list(VALID)


def _from_dotenv(tmp_path, cls, **values):
    name = cls().name
    filename = f'ipyauth-{name}-test.env'
    (tmp_path / filename).write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
    return cls(dotenv_folder=str(tmp_path), dotenv_file=filename)


def test_data_per_provider():
    assert ParamsGoogle(**VALID[ParamsGoogle]).data == {
        'name': 'google',
        'token_endpoint': 'https://oauth2.googleapis.com/token',
        'url_params': {'response_type': 'code', 'client_id': 'g', 'redirect_uri': R,
                       'scope': 'openid profile', 'include_granted_scopes': 'false'},
    }
    assert ParamsKeycloak(**VALID[ParamsKeycloak]).data == {
        'name': 'keycloak',
        'authorize_endpoint': 'https://kc.example.com/realms/r/protocol/openid-connect/auth',
        'token_endpoint': 'https://kc.example.com/realms/r/protocol/openid-connect/token',
        'url_params': {'response_type': 'code', 'client_id': 'k', 'redirect_uri': R,
                       'scope': 'openid profile'},
    }
    assert ParamsAuth0(**VALID[ParamsAuth0], audience='https://api').data == {
        'name': 'auth0',
        'authorize_endpoint': 'https://t.auth0.com/authorize',
        'token_endpoint': 'https://t.auth0.com/oauth/token',
        'url_params': {'response_type': 'code', 'client_id': 'a', 'redirect_uri': R,
                       'audience': 'https://api', 'scope': 'openid profile'},
    }


def test_empty_values_are_omitted_from_data():
    assert 'audience' not in ParamsAuth0(**VALID[ParamsAuth0]).data['url_params']


@pytest.mark.parametrize('cls', PROVIDERS)
def test_dotenv_values_then_constructor_overrides(tmp_path, cls):
    p = _from_dotenv(tmp_path, cls, **VALID[cls])
    assert p.data == cls(**VALID[cls]).data

    name = cls().name
    p = cls(dotenv_folder=str(tmp_path), dotenv_file=f'ipyauth-{name}-test.env', client_id='over')
    assert p.data['url_params']['client_id'] == 'over'


@pytest.mark.parametrize('cls', PROVIDERS)
def test_repr_is_data_json(cls):
    import json
    p = cls(**VALID[cls])
    assert json.loads(repr(p)) == p.data


@pytest.mark.parametrize('cls', PROVIDERS)
def test_response_type_must_be_code(cls):
    assert cls().response_type == 'code'
    assert cls(response_type='code').response_type == 'code'
    for bad in ('token', 'id_token token'):
        with pytest.raises(TraitError, match='response_type must be "code"'):
            cls(response_type=bad)


@pytest.mark.parametrize('cls', PROVIDERS)
@pytest.mark.parametrize('scope', ['openid profile', 'profile openid', 'openid profile email'])
def test_scope_accepts_required_items(cls, scope):
    assert cls(scope=scope).scope == scope


@pytest.mark.parametrize('cls', PROVIDERS)
@pytest.mark.parametrize('scope', ['openid', 'profile', 'email', ''])
def test_scope_rejects_missing_required_item(tmp_path, cls, scope):
    with pytest.raises(TraitError, match='scope must contain'):
        _from_dotenv(tmp_path, cls, scope=scope)


@pytest.mark.parametrize('cls', PROVIDERS)
@pytest.mark.parametrize('uri', ['nope', 'http://evil.example/cb', 'https://u:p@host/cb'])
def test_redirect_uri_validated(cls, uri):
    with pytest.raises(TraitError, match='redirect_uri must be an https url'):
        cls(redirect_uri=uri)


def test_keycloak_base_url_validated():
    with pytest.raises(TraitError, match='base_url must be an https url'):
        ParamsKeycloak(base_url='ftp://kc.example.com')


def test_google_include_granted_scopes():
    assert ParamsGoogle(include_granted_scopes='true').include_granted_scopes == 'true'
    with pytest.raises(TraitError, match='include_granted_scopes'):
        ParamsGoogle(include_granted_scopes='yes')


def test_dotenv_file_must_match_provider(tmp_path):
    (tmp_path / 'ipyauth-auth0-test.env').write_text('client_id=x\n')
    with pytest.raises(ValueError, match='must start with ipyauth-google-'):
        ParamsGoogle(dotenv_folder=str(tmp_path), dotenv_file='ipyauth-auth0-test.env')
