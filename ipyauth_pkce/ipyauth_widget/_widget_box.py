
import ipywidgets as wg

from traitlets import Bool, Unicode, Dict, Int

from ._config import DIC_LOGO
from ._params_base import ParamsBase


def _detect_image_format(data):
    """Best-effort image format detection from magic bytes, defaulting to png."""
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if data[:3] == b'\xff\xd8\xff':
        return 'jpg'
    if data[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    head = data[:256].lstrip()
    if head[:5] == b'<?xml' or head[:4] == b'<svg':
        return 'svg+xml'
    return 'png'


# Version of the JavaScript widget module (ipyauth_pkce/js/package.json), not of
# the Python package. Bump both together only when the model/view contract changes.
_FRONTEND_VERSION = '1.3.0'
_semver_range_frontend_ = f'~{_FRONTEND_VERSION}'


_AUTH_STATES = frozenset({'idle', 'in_progress', 'signed_in', 'cancelled', 'error'})
_AUTH_ERRORS = frozenset({'', 'cancelled', 'error'})


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

    # Not synced: the frontend delivers tokens as custom comm messages so they
    # never become part of the widget state saved into the notebook file.
    access_token = Unicode('')
    refresh_token = Unicode('')
    # Opt-in: the refresh token leaves the Jupyter server only when this is True.
    keep_refresh_token = Bool(False).tag(sync=True)

    scope = Unicode('').tag(sync=True)
    logged_as = Unicode('').tag(sync=True)
    time_to_exp = Unicode('').tag(sync=True)
    expires_at = Unicode('').tag(sync=True)

    # Set by the frontend to a short category ('cancelled' or 'error') when a
    # sign-in attempt ends without a token, so a blocking caller can stop
    # waiting instead of hanging until a timeout. Reset to '' on a new attempt.
    auth_error = Unicode('').tag(sync=True)

    # Set by the frontend to where the sign-in stands: 'idle' (nothing running,
    # not signed in), 'in_progress' (the sign-in popup is open), 'signed_in',
    # 'cancelled' or 'error'. Lets a blocking caller wait only while a sign-in
    # is actually happening.
    auth_state = Unicode('idle').tag(sync=True)

    _incr_signout = Int(0).tag(sync=True)

    def __init__(self,
                 params=None,
                 logo=None,
                 keep_refresh_token=False):
        """
        params : ParamsAuth0 | ParamsGoogle | ParamsKeycloak
            Provider configuration.
        logo : str | os.PathLike | bytes, optional
            Override the provider logo shown in the widget. Pass a path to an
            image file (PNG, JPEG, GIF, WebP or SVG) or the raw image bytes.
            When omitted, the built-in logo for the provider is used.
        keep_refresh_token : bool, optional
            Make the provider's refresh token available as ``refresh_token``.
            Off by default: the Jupyter server then strips it from the token
            response, so it never reaches the browser or the kernel.
        """
        if not isinstance(params, ParamsBase):
            raise TypeError('params must be a ParamsAuth0, ParamsGoogle or ParamsKeycloak object')

        self.keep_refresh_token = bool(keep_refresh_token)
        self.params = params.data
        self.name = self.params['name']

        wg_logo = self.build_widget_logo(logo)
        wg_button_main = self.build_widget_button_main()
        self._btn_main = wg_button_main
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
        self.on_msg(self._handle_frontend_msg)

    def _handle_frontend_msg(self, _widget, content, _buffers):
        if not isinstance(content, dict):
            return
        if content.get('event') == 'auth_state':
            self._apply_auth_state(content)
            return
        if content.get('event') != 'tokens':
            return
        access_token = content.get('access_token', '')
        refresh_token = content.get('refresh_token', '')
        if isinstance(access_token, str) and isinstance(refresh_token, str):
            self.access_token = access_token
            self.refresh_token = refresh_token if self.keep_refresh_token else ''

    def disable(self):
        """Disable the main button, e.g. once nothing is waiting for a sign-in any more."""
        self._btn_main.disabled = True

    def _apply_auth_state(self, content):
        # Also delivered as a custom message because synced trait updates can be
        # held back in the browser while the kernel is blocked in a cell.
        auth_state = content.get('auth_state')
        if auth_state in _AUTH_STATES:
            self.auth_state = auth_state
        auth_error = content.get('auth_error')
        if auth_error in _AUTH_ERRORS:
            self.auth_error = auth_error

    def build_widget_logo(self, logo=None):
        """Build the logo image widget.

        ``logo`` may be raw image bytes, or a path to an image file. When not
        provided, the built-in logo for the provider is loaded.
        """
        if isinstance(logo, (bytes, bytearray)):
            image = bytes(logo)
        else:
            path_img = logo if logo is not None else DIC_LOGO[self.name]
            with open(path_img, 'rb') as f:
                image = f.read()

        widget = wg.Image(
            value=image,
            format=_detect_image_format(image),
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
        self.access_token = ''
        self.refresh_token = ''
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
