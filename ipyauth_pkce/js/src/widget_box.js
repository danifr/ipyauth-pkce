import * as widgets from '@jupyter-widgets/controls';

import auth from './widget_auth';

import packageJson from '../package.json';

const semver_range = `~${packageJson.version}`;

class AuthModel extends widgets.VBoxModel {
    defaults() {
        return {
            ...super.defaults(),
            _model_name: 'AuthModel',
            _view_name: 'AuthView',
            _model_module: 'ipyauth-pkce',
            _view_module: 'ipyauth-pkce',
            _model_module_version: semver_range,
            _view_module_version: semver_range,

            name: '',

            params: {},

            access_token: '',
            scope: '',
            logged_as: '',
            time_to_exp: '',
            expires_at: '',

            _incr_signout: 0,
        };
    }
}

class AuthView extends widgets.VBoxView {
    render() {
        super.render();

        const that = this;

        // Resolve the interactive child widgets by the stable role classes
        // added on the Python side (see _widget_box.py `add_class(...)`),
        // rather than by hard-coded child positions. This keeps the view
        // working if the widget layout is reordered or extended.
        const ROLE_CLASSES = {
            btn_main: 'ipyauth-btn-main',
            logged_as: 'ipyauth-logged-as',
            time_to_exp: 'ipyauth-time-to-exp',
            expires_at: 'ipyauth-expires-at',
            error: 'ipyauth-error',
        };

        // Recursively collect every descendant view, resolving the nested
        // `children_views` promises of container views (e.g. the inner HBox).
        const collectViews = async (rootViews) => {
            const all = [];
            const walk = async (views) => {
                for (const view of views) {
                    if (!view) continue;
                    all.push(view);
                    if (view.children_views && Array.isArray(view.children_views.views)) {
                        const nested = await Promise.all(view.children_views.views);
                        await walk(nested);
                    }
                }
            };
            await walk(rootViews);
            return all;
        };

        const findByRole = (views, roleClass) =>
            views.find(
                (view) =>
                    view &&
                    view.el &&
                    typeof view.el.classList !== 'undefined' &&
                    view.el.classList.contains(roleClass)
            );

        Promise.all(this.children_views.views)
            .then(collectViews)
            .then((allViews) => {
                const resolved = {};
                Object.entries(ROLE_CLASSES).forEach(([role, cls]) => {
                    resolved[role] = findByRole(allViews, cls);
                });

                if (!resolved.btn_main) {
                    console.error('ipyauth: could not resolve the main button view');
                    return;
                }

                const btn_main_clicked = function () {
                    if (auth.isLogged(that)) {
                        auth.clear(that);
                    } else {
                        auth.login(that);
                    }
                };
                resolved.btn_main.el.addEventListener('click', btn_main_clicked);

                that.form = resolved;

                // Streamline the flow: try to launch the auth popup right away
                // on render (cell execution), without requiring a click. If the
                // browser blocks the popup (the common case, since there is no
                // user gesture) or the user is already logged in, this is a
                // no-op and the "Sign In" button remains as the fallback.
                auth.attemptAutoLogin(that).catch((err) => {
                    console.debug('ipyauth: auto-login attempt did not start', err);
                });
            })
            .catch((err) => {
                console.error('ipyauth: failed to resolve widget views', err);
            });

        that.model.on('change:_incr_signout', that.incr_signout, that);
    }

    incr_signout() {
        auth.clear(this);
    }
}

export { AuthModel, AuthView };
