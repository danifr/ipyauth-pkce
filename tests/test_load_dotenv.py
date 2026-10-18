"""
Tests for load_dotenv() suffix handling in ipyauth_pkce.ipyauth_widget._util.

Regression: load_dotenv() accepts a `suffix` argument but previously hardcoded
`suffix = '.env'`, ignoring the caller's value. These tests pin the corrected
behavior: the default suffix is still '.env', and a custom suffix is honored.
"""

import pytest

from ipyauth_pkce.ipyauth_widget._util import load_dotenv


def _write(folder, name, content='client_id=abc\n'):
    path = folder / name
    path.write_text(content, encoding='utf-8')
    return path


class TestLoadDotenvSuffix:
    def test_none_file_returns_empty(self):
        assert load_dotenv('.', None, 'keycloak') == {}

    def test_default_suffix_env_is_accepted(self, tmp_path):
        _write(tmp_path, 'ipyauth-keycloak-test.env')
        dic = load_dotenv(str(tmp_path), 'ipyauth-keycloak-test.env', 'keycloak')
        assert dic == {'client_id': 'abc'}

    def test_default_suffix_rejects_non_env_file(self, tmp_path):
        _write(tmp_path, 'ipyauth-keycloak-test.txt')
        with pytest.raises(ValueError, match='must end with .env'):
            load_dotenv(str(tmp_path), 'ipyauth-keycloak-test.txt', 'keycloak')

    def test_custom_suffix_is_honored(self, tmp_path):
        # Previously this raised because the suffix arg was ignored (forced to
        # '.env'). Now a custom suffix is respected.
        _write(tmp_path, 'ipyauth-keycloak-test.envrc')
        dic = load_dotenv(
            str(tmp_path),
            'ipyauth-keycloak-test.envrc',
            'keycloak',
            suffix='.envrc',
        )
        assert dic == {'client_id': 'abc'}

    def test_custom_suffix_rejects_mismatched_file(self, tmp_path):
        _write(tmp_path, 'ipyauth-keycloak-test.env')
        with pytest.raises(ValueError, match='must end with .envrc'):
            load_dotenv(
                str(tmp_path),
                'ipyauth-keycloak-test.env',
                'keycloak',
                suffix='.envrc',
            )

    def test_invalid_prefix_rejected(self, tmp_path):
        with pytest.raises(ValueError, match='prefix must be'):
            load_dotenv(str(tmp_path), 'ipyauth-notaprovider-x.env', 'notaprovider')


    @pytest.mark.parametrize('dotenv_file, prefix', [
        ('ipyauth-auth0-../../../etc/passwd.env', 'auth0'),
        ('ipyauth-google-../../../secret.env', 'google'),
    ])
    def test_path_traversal_rejected(self, tmp_path, dotenv_file, prefix):
        with pytest.raises(ValueError, match='escapes folder'):
            load_dotenv(str(tmp_path), dotenv_file, prefix)

    def test_missing_file_rejected(self, tmp_path):
        with pytest.raises(ValueError, match='does not exist'):
            load_dotenv(str(tmp_path), 'ipyauth-google-missing.env', 'google')

    def test_filename_must_match_provider(self, tmp_path):
        _write(tmp_path, 'ipyauth-auth0-x.env')
        with pytest.raises(ValueError, match='must start with ipyauth-google-'):
            load_dotenv(str(tmp_path), 'ipyauth-auth0-x.env', 'google')