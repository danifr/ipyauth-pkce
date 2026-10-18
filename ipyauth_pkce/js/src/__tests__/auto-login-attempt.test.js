/**
 * Feature: streamlined auth (option 4)
 *
 * attemptAutoLogin tries to open the auth popup automatically on render,
 * without a user click. Because browsers only allow window.open() during a
 * user gesture, a blocked popup must be treated as a normal outcome (returns
 * false, leaves the manual button as the fallback). When the user has
 * whitelisted popups the attempt succeeds and behaves like a normal login.
 * When already logged in, the attempt is skipped entirely.
 */
import auth from '../widget_auth.js';

function makeThat(loggedAs = '') {
    return {
        model: {
            get: (name) => {
                if (name === 'logged_as') {
                    return loggedAs;
                }
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
}

describe('attemptAutoLogin (streamlined auth)', () => {
    afterEach(() => {
        sessionStorage.clear();
    });

    it('returns true and opens a popup when the browser allows it', async () => {
        const replace = jest.fn();
        const popup = { close: jest.fn(), closed: false, location: { replace } };
        const open = jest.spyOn(window, 'open').mockImplementation(() => popup);

        try {
            const result = await auth.attemptAutoLogin(makeThat());

            expect(open).toHaveBeenCalledTimes(1);
            expect(open.mock.calls[0][0]).toBe('about:blank');
            expect(result).toBe(true);
            // Navigation to the authorize URL happens after PKCE completes.
            expect(replace).toHaveBeenCalledTimes(1);
            expect(replace.mock.calls[0][0]).toContain('response_type=code');
        } finally {
            open.mockRestore();
        }
    });

    it('returns false and cleans up when the popup is blocked', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);

        try {
            const result = await auth.attemptAutoLogin(makeThat());

            expect(open).toHaveBeenCalledTimes(1);
            expect(result).toBe(false);
            // Blocked attempt must not leave dangling expected-state.
            expect(sessionStorage.getItem('ipyauth_expected_state')).toBeNull();
        } finally {
            open.mockRestore();
        }
    });

    it('skips the attempt and does not open a popup when already logged in', async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => ({
            close: jest.fn(),
            closed: false,
            location: { replace: jest.fn() },
        }));

        try {
            const result = await auth.attemptAutoLogin(makeThat('user@example.com'));

            expect(open).not.toHaveBeenCalled();
            expect(result).toBe(false);
        } finally {
            open.mockRestore();
        }
    });
});
