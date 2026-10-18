/**
 * Feature: user-visible authentication errors (REMAINING_OPPORTUNITIES #8)
 *
 * Browser-side auth failures are surfaced in a dedicated widget error field
 * (role="alert") with short, safe, categorized messages — never raw tokens,
 * codes, or provider error_description. The field:
 *   - is shown (display unset) when an error occurs,
 *   - is cleared and hidden at the start of a new login attempt and on clear(),
 *   - is NOT shown for an auto-login popup block (no user gesture; expected).
 */
import auth from '../widget_auth.js';

function makeErrorField() {
    const model = {
        value: '',
        set(obj) {
            if ('value' in obj) this.value = obj.value;
        },
        save_changes() {},
    };
    return {
        model,
        el: { style: { display: 'none' } },
    };
}

function makeThat({ withForm = true, loggedAs = '' } = {}) {
    const that = {
        model: {
            get: (name) => {
                if (name === 'logged_as') return loggedAs;
                if (name === 'params') {
                    return {
                        name: 'google',
                        token_endpoint: 'https://oauth2.googleapis.com/token',
                        url_params: {
                            client_id: 'test-client',
                            redirect_uri: 'http://localhost:8888/callback/',
                            scope: 'openid profile',
                        },
                    };
                }
                return undefined;
            },
        },
    };
    if (withForm) {
        that.form = { error: makeErrorField() };
    }
    return that;
}

describe('user-visible authentication errors (#8)', () => {
    afterEach(() => {
        sessionStorage.clear();
    });

    it('shows an error with role="alert" when a user-initiated popup is blocked', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const that = makeThat();

        try {
            const opened = await auth.login(that);
            expect(opened).toBe(false);

            const field = that.form.error;
            expect(field.el.style.display).toBe('');
            expect(field.model.value).toContain('role="alert"');
            expect(field.model.value.toLowerCase()).toContain('popup');
            // No sensitive material leaked.
            expect(field.model.value).not.toContain('test-client');
        } finally {
            open.mockRestore();
        }
    });

    it('does NOT show an error when the auto-login popup is blocked (no user gesture)', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const that = makeThat();

        try {
            const opened = await auth.attemptAutoLogin(that);
            expect(opened).toBe(false);

            const field = that.form.error;
            expect(field.el.style.display).toBe('none');
            expect(field.model.value).toBe('');
        } finally {
            open.mockRestore();
        }
    });

    it('clears a previous error at the start of a new login attempt', async () => {
        // First: user-initiated blocked popup -> error shown.
        const openBlocked = jest.spyOn(window, 'open').mockImplementation(() => null);
        const that = makeThat();
        try {
            await auth.login(that);
            expect(that.form.error.el.style.display).toBe('');
            expect(that.form.error.model.value).not.toBe('');
        } finally {
            openBlocked.mockRestore();
        }

        // Second: popup now allowed -> the stale error must be cleared/hidden.
        const popup = { close: jest.fn(), closed: false, location: { replace: jest.fn() } };
        const openOk = jest.spyOn(window, 'open').mockImplementation(() => popup);
        try {
            await auth.login(that);
            expect(that.form.error.el.style.display).toBe('none');
            expect(that.form.error.model.value).toBe('');
        } finally {
            openOk.mockRestore();
        }
    });

    it('toggles the layout model display (ipywidgets mechanism) when present', async () => {
        // Mirror the real widget: display is controlled by a layout sub-model.
        const layout = {
            display: 'none',
            set(k, v) {
                if (k === 'display') this.display = v;
            },
            save_changes() {},
        };
        const errorField = {
            model: {
                value: '',
                set(obj) {
                    if ('value' in obj) this.value = obj.value;
                },
                get(name) {
                    return name === 'layout' ? layout : undefined;
                },
                save_changes() {},
            },
            el: { style: { display: 'none' } },
        };
        const that = makeThat();
        that.form.error = errorField;

        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        try {
            await auth.login(that);
            expect(layout.display).toBe('');
            expect(errorField.model.value).not.toBe('');
        } finally {
            open.mockRestore();
        }
    });

    it('does not throw when the widget has no error field wired', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const that = makeThat({ withForm: false });
        try {
            // Should complete without throwing even though that.form is absent.
            const opened = await auth.login(that);
            expect(opened).toBe(false);
        } finally {
            open.mockRestore();
        }
    });
});
