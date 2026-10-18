import { buildReadMessage } from '../widget_auth.js';

class IsolatedBroadcastChannel {
    static instances = [];

    constructor(name) {
        this.name = name;
        this.onmessage = null;
        IsolatedBroadcastChannel.instances.push(this);
    }

    postMessage(data) {
        for (const instance of IsolatedBroadcastChannel.instances) {
            if (instance !== this && instance.name === this.name && instance.onmessage) {
                instance.onmessage({ data });
            }
        }
    }

    close() {
        this.onmessage = null;
    }
}

describe('Per-flow BroadcastChannel isolation', () => {
    it('does not deliver another flow’s callback to the current receiver', async () => {
        const originalBroadcastChannel = globalThis.BroadcastChannel;
        const originalFetch = globalThis.fetch;
        const expectedState = 'google,popup,current-flow';
        let isValidCalled = false;

        globalThis.BroadcastChannel = IsolatedBroadcastChannel;
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    access_token: 'exchanged-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
        });

        const that = {
            params: {
                isValid: () => {
                    isValidCalled = true;
                    return Promise.resolve([false, {}]);
                },
                name: 'google',
                url_params: {
                    state: expectedState,
                    redirect_uri: 'http://localhost/callback',
                    client_id: 'test-client',
                },
                token_endpoint: 'http://localhost/token',
            },
            creds: null,
        };

        try {
            buildReadMessage(that, 'test-verifier');

            const wrongFlowChannel = new IsolatedBroadcastChannel(
                'ipyauth-google%2Cpopup%2Cother-flow'
            );
            wrongFlowChannel.postMessage({
                statusAuth: 'ok',
                code: 'wrong-flow-code',
                state: expectedState,
            });
            await Promise.resolve();
            expect(isValidCalled).toBe(false);

            const currentFlowChannel = new IsolatedBroadcastChannel(
                `ipyauth-${encodeURIComponent(expectedState)}`
            );
            currentFlowChannel.postMessage({
                statusAuth: 'ok',
                code: 'current-flow-code',
                state: expectedState,
            });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(isValidCalled).toBe(true);
        } finally {
            globalThis.BroadcastChannel = originalBroadcastChannel;
            globalThis.fetch = originalFetch;
            IsolatedBroadcastChannel.instances = [];
        }
    });
});
