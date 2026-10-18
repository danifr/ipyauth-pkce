import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { buildReadMessage } from '../widget_auth.js';

const callbackAssets = path.resolve(__dirname, '../../../ipyauth_callback/templates/assets');
const utilSource = fs.readFileSync(path.join(callbackAssets, 'util.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(callbackAssets, 'main.js'), 'utf8');

function runCallback({ callbackState, expectedState, callbackParams = null }) {
    const postedMessages = [];
    const storage = new Map();
    if (expectedState !== undefined) {
        storage.set('ipyauth_expected_state', expectedState);
    }

    const opener = {
        origin: 'http://localhost',
        postMessage: (message, targetOrigin) => {
            postedMessages.push({ message, targetOrigin });
        },
    };
    const params = callbackParams || `code=test-code&state=${encodeURIComponent(callbackState)}`;
    const win = {
        location: {
            href: `http://localhost/callback?${params}`,
            origin: 'http://localhost',
        },
        opener,
        close: jest.fn(),
    };
    const document = {
        createElement: () => ({ textContent: '' }),
        getElementById: () => ({
            textContent: '',
            appendChild: () => {},
        }),
    };
    const context = {
        BroadcastChannel: class {
            postMessage() {}
            close() {}
        },
        TextDecoder,
        URLSearchParams,
        Uint8Array,
        atob,
        document,
        setTimeout: () => {},
        sessionStorage: {
            getItem: (key) => storage.get(key) || null,
            removeItem: (key) => storage.delete(key),
        },
        window: win,
        console,
    };

    vm.runInNewContext(utilSource, context);
    vm.runInNewContext(mainSource, context);
    return postedMessages[0].message;
}

describe('Callback exact state validation', () => {
    it('accepts a callback whose state exactly matches the stored state', () => {
        const state = 'google,popup,expected-state';
        const message = runCallback({ callbackState: state, expectedState: state });

        expect(message.statusAuth).toBe('ok');
        expect(message.code).toBe('test-code');
    });

    it('rejects a callback with a different state', () => {
        const message = runCallback({
            callbackState: 'google,popup,attacker-state',
            expectedState: 'google,popup,expected-state',
        });

        expect(message.statusAuth).toBe('error');
        expect(message.error).toBe('state_mismatch');
    });

    it('rejects an implicit access-token response without forwarding the token', () => {
        const state = 'google,popup,expected-state';
        const message = runCallback({
            callbackState: state,
            expectedState: state,
            callbackParams: `access_token=secret-token&state=${encodeURIComponent(state)}`,
        });

        expect(message.statusAuth).toBe('error');
        expect(message.state).toBe(state);
        expect(message.access_token).toBeUndefined();
        expect(message.id_token).toBeUndefined();
    });

    it('rejects a callback when no expected state is stored', () => {
        const message = runCallback({
            callbackState: 'google,popup,expected-state',
        });

        expect(message.statusAuth).toBe('error');
        expect(message.error).toBe('state_mismatch');
    });
});

describe('Opener exact state validation', () => {
    it('ignores a same-origin callback with a different state', async () => {
        let isValidCalled = false;
        const that = {
            params: {
                isValid: () => {
                    isValidCalled = true;
                    return Promise.resolve([false, {}]);
                },
                name: 'google',
                url_params: {
                    state: 'google,popup,expected-state',
                },
            },
            creds: null,
        };
        const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const readMessage = buildReadMessage(that, 'test-verifier');

        try {
            readMessage({
                origin: window.location.origin,
                data: {
                    statusAuth: 'ok',
                    code: 'attacker-code',
                    state: 'google,popup,attacker-state',
                },
            });
            await Promise.resolve();

            expect(isValidCalled).toBe(false);
            expect(warning).toHaveBeenCalledWith(
                'ipyauth: Ignored callback with unexpected OAuth state'
            );
        } finally {
            warning.mockRestore();
        }
    });
});
