import auth from '../widget_auth.js';

describe('Popup user activation', () => {
    it('opens the popup before the asynchronous PKCE challenge completes', async () => {
        let resolveDigest;
        const digestPromise = new Promise((resolve) => {
            resolveDigest = resolve;
        });
        const originalDigest = crypto.subtle.digest;
        crypto.subtle.digest = jest.fn(() => digestPromise);

        const replace = jest.fn();
        const popup = {
            close: jest.fn(),
            closed: false,
            location: { replace },
        };
        const open = jest.spyOn(window, 'open').mockImplementation(() => {
            expect(sessionStorage.getItem('ipyauth_expected_state')).toMatch(/^google,popup,/);
            return popup;
        });
        const that = {
            model: {
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
            },
        };

        try {
            const loginPromise = auth.login(that);

            expect(open).toHaveBeenCalledTimes(1);
            expect(open.mock.calls[0][0]).toBe('about:blank');
            expect(replace).not.toHaveBeenCalled();

            resolveDigest(new Uint8Array(32).buffer);
            await loginPromise;

            expect(replace).toHaveBeenCalledTimes(1);
            expect(replace.mock.calls[0][0]).toContain('response_type=code');
            expect(replace.mock.calls[0][0]).toContain('code_challenge=');
        } finally {
            crypto.subtle.digest = originalDigest;
            open.mockRestore();
        }
    });
});
