/**
 * Bugfix: popup-blocked-auth-flow
 * Property 1: Bug Condition — Auth Code Not Delivered When window.opener Is Null
 *
 * Validates: Requirements 1.1, 1.2, 2.1, 2.2
 *
 * These tests MUST FAIL on unfixed code — failure confirms the bug exists.
 * DO NOT attempt to fix the test or the code when it fails.
 *
 * The bug: when the browser blocks a popup and the user later allows it,
 * window.opener is null. sendMessageToParent only sends via
 * window.opener.postMessage, so the auth code is silently lost.
 * The expected fix: a state-derived BroadcastChannel fallback.
 */

import fc from 'fast-check';
import { buildReadMessage } from '../widget_auth.js';
// Use the REAL callback sendMessageToParent (BroadcastChannel fallback) so this
// bug-condition coverage tests the shipped code, not a copy.
const { sendMessageToParent } = require('../../../ipyauth_callback/templates/assets/util.js');

describe('Property 1: Bug Condition — Auth Code Not Delivered When window.opener Is Null', () => {
    /**
     * Test 1a: sendMessageToParent with window.opener = null should send via
     * BroadcastChannel delivery on the state-derived channel. On UNFIXED code,
     * occurs, so this assertion FAILS (confirms bug).
     *
     * **Validates: Requirements 1.1, 1.2**
     */
    it('1a: sendMessageToParent sends via BroadcastChannel when window.opener is null', () => {
        // Track BroadcastChannel usage
        let bcPostMessageCalled = false;
        let bcPostedData = null;
        let bcChannelName = null;

        // Mock BroadcastChannel
        const originalBC = globalThis.BroadcastChannel;
        globalThis.BroadcastChannel = class MockBroadcastChannel {
            constructor(name) {
                bcChannelName = name;
            }
            postMessage(data) {
                bcPostMessageCalled = true;
                bcPostedData = data;
            }
            close() {}
        };

        try {
            // Simulate callback window with opener = null
            const fakeWindow = {
                opener: null,
                location: { origin: 'http://localhost' },
            };

            const authMsg = {
                statusAuth: 'ok',
                code: 'abc',
                state: 'keycloak,popup,xyz',
            };

            sendMessageToParent(fakeWindow, authMsg);

            // On UNFIXED code: BroadcastChannel is never used → these FAIL
            expect(bcPostMessageCalled).toBe(true);
            expect(bcChannelName).toBe('ipyauth-keycloak%2Cpopup%2Cxyz');
            expect(bcPostedData).toEqual(authMsg);
        } finally {
            // Restore
            if (originalBC) {
                globalThis.BroadcastChannel = originalBC;
            } else {
                delete globalThis.BroadcastChannel;
            }
        }
    });

    /**
     * Test 1b (PBT): For all valid auth response objects with window.opener = null,
     * BroadcastChannel delivery should occur. On UNFIXED code, all FAIL.
     *
     * **Validates: Requirements 1.2, 2.1**
     */
    it('1b: BroadcastChannel delivery for any valid auth response when opener is null', () => {
        const originalBC = globalThis.BroadcastChannel;

        try {
            fc.assert(
                fc.property(
                    // Generate random valid auth response objects
                    fc.record({
                        statusAuth: fc.constantFrom('ok', 'error'),
                        code: fc.string({ minLength: 1, maxLength: 64 }),
                        state: fc
                            .tuple(
                                fc.constantFrom('keycloak', 'auth0', 'google'),
                                fc.constant('popup'),
                                fc.stringMatching(/^[0-9a-f]{4,16}$/)
                            )
                            .map((parts) => parts.join(',')),
                        access_token: fc.option(fc.string({ minLength: 8, maxLength: 128 }), {
                            nil: undefined,
                        }),
                    }),
                    (authMsg) => {
                        let bcPostMessageCalled = false;
                        let bcPostedData = null;

                        globalThis.BroadcastChannel = class MockBroadcastChannel {
                            constructor() {}
                            postMessage(data) {
                                bcPostMessageCalled = true;
                                bcPostedData = data;
                            }
                            close() {}
                        };

                        const fakeWindow = {
                            opener: null,
                            location: { origin: 'http://localhost' },
                        };

                        sendMessageToParent(fakeWindow, authMsg);

                        // On UNFIXED code: BroadcastChannel is never used → FAILS
                        expect(bcPostMessageCalled).toBe(true);
                        expect(bcPostedData).toEqual(authMsg);
                    }
                ),
                { numRuns: 100 }
            );
        } finally {
            if (originalBC) {
                globalThis.BroadcastChannel = originalBC;
            } else {
                delete globalThis.BroadcastChannel;
            }
        }
    });

    /**
     * Test 1c: buildReadMessage should be able to receive and process a message
     * arriving via BroadcastChannel. On UNFIXED code, no BroadcastChannel
     * listener exists in buildReadMessage, so this FAILS.
     *
     * **Validates: Requirements 2.1, 2.2**
     */
    it('1c: buildReadMessage receives auth message via BroadcastChannel', (done) => {
        // Track whether the auth processing path was reached
        let isValidCalled = false;

        const mockThat = {
            params: {
                isValid: () => {
                    isValidCalled = true;
                    return Promise.resolve([false, {}]);
                },
                name: 'keycloak',
                url_params: {
                    redirect_uri: 'http://localhost/callback',
                    client_id: 'test-client',
                    state: 'keycloak,popup,abc123',
                },
                token_endpoint: 'http://localhost/token',
            },
            creds: null,
        };

        // Give the BroadcastChannel listener a moment to be set up, then send a message
        // We simulate what the callback page would do: send via BroadcastChannel
        const originalBC = globalThis.BroadcastChannel;
        const originalFetch = globalThis.fetch;

        // Mock fetch for token exchange — returns valid token data
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    access_token: 'exchanged-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
        });

        // We need a real-ish BroadcastChannel mock that supports onmessage
        // On UNFIXED code, buildReadMessage does NOT create a BroadcastChannel listener,
        // so sending a message on the channel will not trigger any processing.
        /* eslint-disable no-underscore-dangle */
        class TestBroadcastChannel {
            constructor(name) {
                this._name = name;
                // Track all instances so sender can deliver to widget channel
                TestBroadcastChannel._instances.push(this);
            }
            postMessage(data) {
                // Deliver to any registered onmessage handler on OTHER instances
                for (const inst of TestBroadcastChannel._instances) {
                    if (inst !== this && inst.onmessage) {
                        inst.onmessage({ data });
                    }
                }
            }
            close() {
                this.onmessage = null;
            }
        }
        TestBroadcastChannel._instances = [];
        /* eslint-enable no-underscore-dangle */

        globalThis.BroadcastChannel = TestBroadcastChannel;

        try {
            // Re-create readMessage with our mock BroadcastChannel in place
            // eslint-disable-next-line no-unused-vars
            const readMessage2 = buildReadMessage(mockThat, 'test-verifier');

            // Now simulate the callback page sending via BroadcastChannel
            // Use authorization code flow (code field present) to trigger token exchange
            const senderChannel = new TestBroadcastChannel(
                `ipyauth-${encodeURIComponent('keycloak,popup,abc123')}`
            );
            senderChannel.postMessage({
                statusAuth: 'ok',
                code: 'test-auth-code',
                state: 'keycloak,popup,abc123',
            });

            // On UNFIXED code: buildReadMessage does NOT set up a BroadcastChannel
            // listener, so isValidCalled remains false → assertion FAILS
            // Use setTimeout to allow async token exchange + isValid processing
            setTimeout(() => {
                try {
                    expect(isValidCalled).toBe(true);
                    done();
                } catch (err) {
                    done(err);
                } finally {
                    globalThis.fetch = originalFetch;
                    if (originalBC) {
                        globalThis.BroadcastChannel = originalBC;
                    } else {
                        delete globalThis.BroadcastChannel;
                    }
                }
            }, 100);
        } catch (err) {
            globalThis.fetch = originalFetch;
            if (originalBC) {
                globalThis.BroadcastChannel = originalBC;
            } else {
                delete globalThis.BroadcastChannel;
            }
            done(err);
        }
    });
});
