from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("ipyauth-pkce")
except PackageNotFoundError:  # running from a source checkout without installing
    __version__ = "0.0.0+unknown"

from .ipyauth_widget import Auth, ParamsAuth0, ParamsGoogle, ParamsKeycloak

__all__ = ['Auth', 'ParamsAuth0', 'ParamsGoogle', 'ParamsKeycloak']
