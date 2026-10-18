/**
 * Feature: jupyterlab-auth-improvements
 * Property 5: Messages with mismatched origins are discarded
 *
 * Validates: Requirements 3.2
 *
 * For any MessageEvent where event.origin does not match the expected callback
 * origin, the Auth_Flow_Manager's readMessage handler SHALL not update widget
 * credentials or trigger token exchange.
 */

import fc from 'fast-check';
import { buildReadMessage } from '../widget_auth.js';

describe('Property 5: Messages with mismatched origins are discarded', () => {
    // jsdom default origin is 'http://localhost'
    const expectedOrigin = window.location.origin;

    /**
     * **Validates: Requirements 3.2**
     */
    it('readMessage discards messages when event.origin does not match expected origin', () => {
        fc.assert(
            fc.property(
                // Generate a random mismatched origin (never equal to expected)
                fc.webUrl().filter((url) => {
                    try {
                        const { origin } = new URL(url);
                        return origin !== expectedOrigin;
                    } catch {
                        return true;
                    }
                }),
                fc.constantFrom('ok', 'error'),
                (mismatchedUrl, statusAuth) => {
                    let mismatchedOrigin;
                    try {
                        mismatchedOrigin = new URL(mismatchedUrl).origin;
                    } catch {
                        mismatchedOrigin = mismatchedUrl;
                    }

                    // Track whether credentials were updated
                    let isValidCalled = false;

                    const mockThat = {
                        params: {
                            isValid: () => {
                                isValidCalled = true;
                                return Promise.resolve([true, {}]);
                            },
                        },
                        creds: null,
                    };

                    const readMessage = buildReadMessage(mockThat, 'dummy-verifier');

                    // Create a fake MessageEvent with mismatched origin
                    const fakeEvent = {
                        origin: mismatchedOrigin,
                        data: {
                            statusAuth,
                            state: 'keycloak,popup,abc123',
                            access_token: 'fake-token',
                        },
                    };

                    readMessage(fakeEvent);

                    // Credentials should NOT have been updated
                    expect(mockThat.creds).toBeNull();
                    expect(isValidCalled).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('readMessage processes messages when event.origin matches expected origin', async () => {
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

        // Mock fetch for token exchange — returns valid token data
        const originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () =>
                Promise.resolve({
                    access_token: 'exchanged-access-token',
                    token_type: 'Bearer',
                    expires_in: 3600,
                }),
        });

        try {
            const readMessage = buildReadMessage(mockThat, 'dummy-verifier');

            // Use the actual jsdom origin so it matches
            // Include code field to use authorization code flow (implicit flow is rejected)
            const matchingEvent = {
                origin: expectedOrigin,
                data: {
                    statusAuth: 'ok',
                    state: 'keycloak,popup,abc123',
                    code: 'test-auth-code',
                },
            };

            readMessage(matchingEvent);

            // Wait for async token exchange + isValid processing
            await new Promise((resolve) => setTimeout(resolve, 100));

            // isValid should have been called since origin matches
            expect(isValidCalled).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
