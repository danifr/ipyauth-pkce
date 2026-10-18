"""Packaging and Jupyter integration contracts.

These pin values that other systems depend on (Jupyter server-extension
discovery, the widget's module identity shared by Python and JavaScript, and
dependency bounds) by importing/parsing them rather than grepping source text.
"""

import json
import pathlib
import re
import tomllib

from packaging.requirements import Requirement

import ipyauth_pkce
from ipyauth_pkce import Auth
from ipyauth_pkce import ipyauth_callback

ROOT = pathlib.Path(__file__).resolve().parent.parent
PKG_JSON = json.loads((ROOT / 'ipyauth_pkce' / 'js' / 'package.json').read_text())
PYPROJECT = tomllib.loads((ROOT / 'pyproject.toml').read_text())


def _dependency(name):
    for spec in PYPROJECT['project']['dependencies']:
        req = Requirement(spec)
        if req.name.replace('-', '_') == name:
            return req
    raise AssertionError(f'{name} not declared in pyproject.toml')


def test_server_extension_discovery():
    assert ipyauth_callback._jupyter_server_extension_points() == [
        {'module': 'ipyauth_pkce.ipyauth_callback.server_extension'}
    ]
    from ipyauth_pkce.ipyauth_callback import server_extension
    assert callable(server_extension._load_jupyter_server_extension)


def test_server_extension_enabled_by_config_file():
    config = json.loads(
        (ROOT / 'ipyauth_pkce' / 'ipyauth_callback' / 'ipyauth-pkce.json').read_text()
    )
    assert config == {
        'ServerApp': {
            'jpserver_extensions': {'ipyauth_pkce.ipyauth_callback.server_extension': True}
        }
    }


def test_dependency_bounds():
    # @allow_unauthenticated needs jupyter_server >= 2.13; the widget targets ipywidgets 8.
    assert _dependency('jupyter_server').specifier.contains('2.13.0')
    assert not _dependency('jupyter_server').specifier.contains('2.12.0')
    assert _dependency('ipywidgets').specifier.contains('8.1.0')
    assert not _dependency('ipywidgets').specifier.contains('9.0.0')


def test_python_version_is_dynamic():
    from importlib.metadata import PackageNotFoundError, version
    try:
        assert ipyauth_pkce.__version__ == version('ipyauth-pkce')
    except PackageNotFoundError:
        assert ipyauth_pkce.__version__ == '0.0.0+unknown'
    assert PYPROJECT['project']['dynamic'] == ['version']
    assert 'version' not in PYPROJECT['project']


def test_widget_requests_the_registered_frontend_version():
    # labplugin.js registers the widget module under package.json's version.
    assert Auth._model_module_version.default_value == f"~{PKG_JSON['version']}"
    assert Auth._view_module_version.default_value == f"~{PKG_JSON['version']}"


def test_widget_identity_matches_frontend():
    name = PKG_JSON['name']
    assert Auth._model_module.default_value == name
    assert Auth._view_module.default_value == name
    assert Auth._model_name.default_value == 'AuthModel'
    assert Auth._view_name.default_value == 'AuthView'

    # The JS side registers the same module name; this is a cross-language
    # contract, so a targeted source check is the simplest reliable test.
    src = ROOT / 'ipyauth_pkce' / 'js' / 'src'
    assert re.search(rf"_model_module: '{name}'", (src / 'widget_box.js').read_text())
    assert re.search(rf"_view_module: '{name}'", (src / 'widget_box.js').read_text())
    assert re.search(rf"name: '{name}'", (src / 'labplugin.js').read_text())


def test_install_json_names_the_python_package():
    install = json.loads((ROOT / 'install.json').read_text())
    assert install['packageName'] == PYPROJECT['project']['name'] == PKG_JSON['name']


def test_built_labextension_matches_package():
    built_pkg = ROOT / 'ipyauth_pkce' / 'labextension' / 'package.json'
    assert built_pkg.is_file(), 'JupyterLab extension not built: run `npm run build` in ipyauth_pkce/js'
    built = json.loads(built_pkg.read_text())
    assert built['name'] == PKG_JSON['name']
    assert built['version'] == PKG_JSON['version']
    remote = built['jupyterlab']['_build']['load']
    assert (ROOT / 'ipyauth_pkce' / 'labextension' / remote).is_file()


def test_synced_traits():
    synced = set(Auth.class_trait_names(sync=True))
    assert {
        'name', 'params', 'access_token', 'scope', 'logged_as',
        'time_to_exp', 'expires_at', '_incr_signout',
    } <= synced
