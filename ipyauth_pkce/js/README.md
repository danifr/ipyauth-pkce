# ipyauth-pkce — JavaScript

The frontend part of the ipyauth-pkce widget. Handles the OAuth2 Authorization Code + PKCE flow, popup management, token exchange, and JupyterLab extension registration.

## Structure

- `src/labplugin.js` — JupyterLab plugin: registers the widget module
- `src/app_commands.js` — Moves notebook focus to the next cell after sign-in
- `src/widget_auth.js` — Auth flow logic (PKCE, popup, BroadcastChannel fallback, token exchange)
- `src/widget.js`, `src/widget_box.js` — Widget model and view (buttons, display fields)
- `src/widget_util.js` — Utility functions
- `src/providers/` — Provider-specific configs (Keycloak, Auth0, Google)
- `src/__tests__/` — Jest tests (some property-based with fast-check)

## Commands

```bash
# Run tests and lint
npm test
npm run lint

# Build the JupyterLab extension into ../labextension (a gitignored build
# output; needs `jupyter-builder` on PATH, e.g. from the Python dev environment)
npm run build
```
