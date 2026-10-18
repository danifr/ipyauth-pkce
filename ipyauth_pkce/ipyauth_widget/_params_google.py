from traitlets import TraitError, Unicode, validate

from ._params_base import ParamsBase


class ParamsGoogle(ParamsBase):
    """
    See Google doc https://developers.google.com/identity/protocols/OAuth2
    """

    _params_fields = ('name', 'token_endpoint')
    _url_params_fields = ('response_type', 'client_id', 'redirect_uri', 'scope', 'include_granted_scopes')

    include_granted_scopes = Unicode()

    def __init__(self,
                 name='google',
                 response_type=None,
                 client_id=None,
                 redirect_uri=None,
                 scope=None,
                 include_granted_scopes='false',

                 dotenv_folder='.',
                 dotenv_file=None,
                 ):
        super().__init__(name, dotenv_folder, dotenv_file,
                         response_type=response_type, client_id=client_id,
                         redirect_uri=redirect_uri, scope=scope,
                         include_granted_scopes=include_granted_scopes)

    def _endpoints(self):
        return {'token_endpoint': 'https://oauth2.googleapis.com/token'}

    @validate('include_granted_scopes')
    def _valid_include_granted_scopes(self, proposal):
        if proposal['value'] not in ('true', 'false'):
            raise TraitError('include_granted_scopes must be "true" or "false"')
        return proposal['value']
