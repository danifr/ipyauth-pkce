/**
 * The refresh token is opt-in (`keep_refresh_token`): the widget asks the server
 * for it only when enabled, and never hands one to the kernel otherwise.
 */
import { buildReadMessage } from '../widget_auth.js';

const STATE = 'google,popup,refresh-opt-in';

function makeField() {
    return { model: { set: jest.fn(), set_state: jest.fn(), save_changes: jest.fn() } };
}

function makeThat(keepRefreshToken) {
    return {
        params: {
            name: 'google',
            token_endpoint: 'https://oauth2.googleapis.com/token',
            url_params: {
                state: STATE,
                redirect_uri: 'http://localhost/callback',
                client_id: 'cid',
            },
            isValid: (_params, creds) =>
                Promise.resolve([true, { ...creds, username: 'jdoe', expiry: new Date(0) }]),
        },
        model: {
            get: (name) => (name === 'keep_refresh_token' ? keepRefreshToken : undefined),
            set: jest.fn(),
            save_changes: jest.fn(),
            send: jest.fn(),
        },
        form: {
            btn_main: makeField(),
            logged_as: makeField(),
            time_to_exp: makeField(),
            expires_at: makeField(),
        },
        creds: null,
    };
}

async function signIn(that) {
    const readMessage = buildReadMessage(that, 'v'.repeat(43));
    readMessage({
        origin: window.location.origin,
        data: { statusAuth: 'ok', code: 'c', state: STATE },
    });
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve(); // let the exchange promise chain settle
    }
}

describe('refresh token opt-in', () => {
    let originalFetch;
    let originalBroadcastChannel;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        originalBroadcastChannel = globalThis.BroadcastChannel;
        globalThis.BroadcastChannel = class {
            postMessage() {}
            close() {}
        };
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            // As if the server had not stripped it, to check the widget drops it too.
            json: () =>
                Promise.resolve({ access_token: 'at', refresh_token: 'rt', expires_in: 300 }),
        });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        globalThis.BroadcastChannel = originalBroadcastChannel;
    });

    it('does not ask for or forward the refresh token by default', async () => {
        const that = makeThat(false);
        await signIn(that);

        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.keep_refresh_token).toBe(false);
        expect(that.model.send).toHaveBeenCalledWith({
            event: 'tokens',
            access_token: 'at',
            refresh_token: '',
        });
        expect(that.creds.refresh_token).toBeUndefined();
    });

    it('asks for and forwards the refresh token when enabled', async () => {
        const that = makeThat(true);
        await signIn(that);

        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.keep_refresh_token).toBe(true);
        expect(that.model.send).toHaveBeenCalledWith({
            event: 'tokens',
            access_token: 'at',
            refresh_token: 'rt',
        });
    });
});
