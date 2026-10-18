from traitlets import Unicode

from ._params_base import ParamsBase


class ParamsAuth0(ParamsBase):
    """
    See Auth0 doc https://auth0.com/docs/api/authentication#authorize-application
    """

    _params_fields = ('name', 'authorize_endpoint', 'token_endpoint')
    _url_params_fields = ('response_type', 'client_id', 'redirect_uri', 'audience', 'scope')

    domain = Unicode()
    audience = Unicode()

    def __init__(self,
                 name='auth0',
                 response_type=None,
                 domain=None,
                 client_id=None,
                 redirect_uri=None,
                 audience=None,
                 scope=None,

                 dotenv_folder='.',
                 dotenv_file=None,
                 ):
        super().__init__(name, dotenv_folder, dotenv_file,
                         response_type=response_type, domain=domain, client_id=client_id,
                         redirect_uri=redirect_uri, audience=audience, scope=scope)

    def _endpoints(self):
        return {
            'authorize_endpoint': f'https://{self.domain}/authorize',
            'token_endpoint': f'https://{self.domain}/oauth/token',
        }
