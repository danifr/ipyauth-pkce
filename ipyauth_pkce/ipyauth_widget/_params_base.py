import json

from traitlets import HasTraits, TraitError, Unicode, validate

from ._util import is_url, load_dotenv

_URL_RULE = 'an https url (http is allowed only for localhost)'


class ParamsBase(HasTraits):
    """Shared behavior of the provider parameter classes.

    Values are taken from the optional dotenv file first, then overridden by any
    truthy constructor argument. Subclasses declare which attributes end up in
    ``data`` (top level vs ``url_params``) and compute their endpoints.
    """

    _params_fields = ()
    _url_params_fields = ()

    name = Unicode()
    response_type = Unicode('code')
    client_id = Unicode()
    redirect_uri = Unicode()
    scope = Unicode()

    def __init__(self, name, dotenv_folder, dotenv_file, **overrides):
        super().__init__()
        for k, v in load_dotenv(dotenv_folder, dotenv_file, name).items():
            setattr(self, k, v)
        self.name = name
        for k, v in overrides.items():
            if v:
                setattr(self, k, v)
        for k, v in self._endpoints().items():
            setattr(self, k, v)
        self.data = self.build_data()

    def _endpoints(self):
        """Return the provider endpoints derived from the configured values."""
        return {}

    def build_data(self):
        """Build the provider config dict, keeping only non-empty values."""
        def pick(fields):
            return {k: getattr(self, k, '') for k in fields if getattr(self, k, '') != ''}

        data = pick(self._params_fields)
        data['url_params'] = pick(self._url_params_fields)
        return data

    def __repr__(self):
        return json.dumps(self.data, sort_keys=False, indent=2)

    @validate('response_type')
    def _valid_response_type(self, proposal):
        """Require the authorization-code response type for PKCE."""
        if proposal['value'] != 'code':
            raise TraitError('response_type must be "code"')
        return proposal['value']

    @validate('redirect_uri')
    def _valid_redirect_uri(self, proposal):
        if not is_url(proposal['value']):
            raise TraitError(f'redirect_uri must be {_URL_RULE}')
        return proposal['value']

    @validate('scope')
    def _valid_scope(self, proposal):
        """Require every claimed-mandatory scope to be present."""
        if not {'openid', 'profile'}.issubset(proposal['value'].split(' ')):
            raise TraitError('scope must contain "openid" and "profile"')
        return proposal['value']
