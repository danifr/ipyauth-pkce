
import ipywidgets as wg

from traitlets import Unicode, Dict, Int

from ._config import DIC_LOGO
from ._params_base import ParamsBase


# Version of the JavaScript widget module (ipyauth_pkce/js/package.json), not of
# the Python package. Bump both together only when the model/view contract changes.
_FRONTEND_VERSION = '1.0.0'
_semver_range_frontend_ = f'~{_FRONTEND_VERSION}'


class Auth(wg.VBox):
    """
    Auth widget made of ipywidgets
    """
    _model_name = Unicode('AuthModel').tag(sync=True)
    _view_name = Unicode('AuthView').tag(sync=True)
    _model_module = Unicode('ipyauth-pkce').tag(sync=True)
    _view_module = Unicode('ipyauth-pkce').tag(sync=True)
    _model_module_version = Unicode(_semver_range_frontend_).tag(sync=True)
    _view_module_version = Unicode(_semver_range_frontend_).tag(sync=True)

    name = Unicode('').tag(sync=True)

    params = Dict({}).tag(sync=True)

    access_token = Unicode('').tag(sync=True)
    scope = Unicode('').tag(sync=True)
    logged_as = Unicode('').tag(sync=True)
    time_to_exp = Unicode('').tag(sync=True)
    expires_at = Unicode('').tag(sync=True)

    _incr_signout = Int(0).tag(sync=True)

    def __init__(self,
                 params=None):
        """
        """
        if not isinstance(params, ParamsBase):
            raise TypeError('params must be a ParamsAuth0, ParamsGoogle or ParamsKeycloak object')

        self.params = params.data
        self.name = self.params['name']

        wg_logo = self.build_widget_logo()
        wg_button_main = self.build_widget_button_main()
        wg_logged_as = self.build_widget_logged_as()
        wg_time_to_exp = self.build_widget_time_to_exp()
        wg_expire_at = self.build_widget_expire_at()
        wg_error = self.build_widget_error()
        b1 = wg.HBox([wg_logo,
                      wg_button_main,
                      wg_logged_as,
                      wg_time_to_exp,
                      wg_expire_at,
                      wg_error,
                      ]
                     )

        super().__init__([b1])

    def build_widget_logo(self):
        """
        """
        path_img = DIC_LOGO[self.name]
        with open(path_img, 'rb') as f:
            image = f.read()

        widget = wg.Image(
            value=image,
            format='png',
            layout=wg.Layout(
                max_height='26px',
                margin='3px',
                align_self='center'),
        )
        return widget

    def build_widget_button_main(self):
        """
        """
        widget = wg.Button(
            description='Sign In',
            button_style='info',
            layout=wg.Layout(width='90px',
                             margin='0 5px 0 5px',
                             align_self='center'),
        )
        widget.style.button_color = '#4885ed'
        widget.add_class('ipyauth-btn-main')
        return widget

    def build_widget_logged_as(self):
        """
        """
        widget = wg.HTML(
            layout=wg.Layout(
                width='275px',
                border='1px lightgray solid',
                padding='3px')
        )
        widget.add_class('ipyauth-logged-as')
        return widget

    def build_widget_time_to_exp(self):
        """Hidden by default. Set layout.display='' to show."""
        widget = wg.HTML(
            layout=wg.Layout(
                display='none',
                width='70px',
                border='1px lightgray solid',
                padding='3px')
        )
        widget.add_class('ipyauth-time-to-exp')
        return widget

    def build_widget_expire_at(self):
        """Hidden by default. Set layout.display='' to show."""
        widget = wg.HTML(
            layout=wg.Layout(
                display='none',
                width='300px',
                border='1px lightgray solid',
                padding='3px')
        )
        widget.add_class('ipyauth-expires-at')
        return widget

    def build_widget_error(self):
        """Hidden by default. Shown by the frontend on authentication errors."""
        widget = wg.HTML(
            layout=wg.Layout(
                display='none',
                width='300px',
                margin='0 5px 0 5px',
                align_self='center')
        )
        widget.add_class('ipyauth-error')
        return widget

    def show(self):
        """Print key session attributes."""
        for attr in ['name', 'logged_as', 'expires_at', 'access_token']:
            print(f'{attr} = {getattr(self, attr)}')

    def clear(self):
        """
        """
        self._incr_signout += 1

    @property
    def headers(self):
        """Return Authorization headers ready to use with requests."""
        if not self.access_token:
            return {}
        return {'Authorization': f'Bearer {self.access_token}'}

    @property
    def is_authenticated(self):
        """Check if the user is currently authenticated."""
        return bool(self.access_token)

    def __repr__(self):
        if self.access_token:
            return (
                f"Auth(provider='{self.name}', "
                f"user='{self.logged_as}', "
                f"expires='{self.expires_at}')"
            )
        return f"Auth(provider='{self.name}', status='not authenticated')"
