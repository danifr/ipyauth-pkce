from traitlets import TraitError, Unicode, validate

from ._params_base import ParamsBase, _URL_RULE
from ._util import is_url


class ParamsKeycloak(ParamsBase):
    """
    See Keycloak doc https://www.keycloak.org/docs/latest/securing_apps/
    """

    _params_fields = ('name', 'authorize_endpoint', 'token_endpoint')
    _url_params_fields = ('response_type', 'client_id', 'redirect_uri', 'scope')

    base_url = Unicode()
    realm = Unicode()

    def __init__(self,
                 name='keycloak',
                 base_url=None,
                 realm=None,
                 response_type=None,
                 client_id=None,
                 redirect_uri=None,
                 scope=None,

                 dotenv_folder='.',
                 dotenv_file=None,
                 ):
        super().__init__(name, dotenv_folder, dotenv_file,
                         base_url=base_url, realm=realm, response_type=response_type,
                         client_id=client_id, redirect_uri=redirect_uri, scope=scope)

    def _endpoints(self):
        realm_url = f'{self.base_url}/realms/{self.realm}/protocol/openid-connect'
        return {
            'authorize_endpoint': f'{realm_url}/auth',
            'token_endpoint': f'{realm_url}/token',
        }

    @validate('base_url')
    def _valid_base_url(self, proposal):
        if not is_url(proposal['value']):
            raise TraitError(f'base_url must be {_URL_RULE}')
        return proposal['value']
