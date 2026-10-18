import os

# Must match the JavaScript providers in ipyauth_pkce/js/src/providers/index.js.
VALID_ID_PROVIDERS = ['auth0', 'google', 'keycloak']

_IMG_DIR = os.path.join(os.path.dirname(__file__), 'img')
DIC_LOGO = {name: os.path.join(_IMG_DIR, f'{name}-logo.png') for name in VALID_ID_PROVIDERS}
