/**
 * The widget publishes a terminal outcome to Python via the synced
 * `auth_error` trait ('cancelled' | 'error') so a blocking caller (e.g.
 * obi-auth's notebook flow) can stop waiting instead of hanging until a
 * timeout. It is reset to '' at the start of a new attempt.
 */
import auth from '../widget_auth.js';

function makeModel() {
    const captured = { auth_error: undefined };
    return {
        get: (name) => {
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
        set: (obj) => Object.assign(captured, obj),
        save_changes: () => {},
        captured,
    };
}

function makeThat() {
    return { model: makeModel() };
}

describe('auth_error terminal signal', () => {
    afterEach(() => {
        sessionStorage.clear();
    });

    it("sets auth_error='error' when a user-initiated popup is blocked", async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const that = makeThat();
        try {
            const opened = await auth.login(that); // user-initiated
            expect(opened).toBe(false);
            expect(that.model.captured.auth_error).toBe('error');
        } finally {
            open.mockRestore();
        }
    });

    it('resets auth_error to empty at the start of a new attempt', async () => {
        const that = makeThat();
        // Seed a stale error, then an auto attempt: it is reset to '' first.
        that.model.set({ auth_error: 'cancelled' });
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        try {
            await auth.attemptAutoLogin(that); // not user-initiated -> no error set
            expect(that.model.captured.auth_error).toBe('');
        } finally {
            open.mockRestore();
        }
    });
});
