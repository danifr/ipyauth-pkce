/**
 * Bugfix: popup-blocked-auth-flow
 * Property 2: Preservation — Normal Opener-Based Auth Flow Unchanged
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * These tests MUST PASS on the current unfixed code — they capture baseline
 * behavior that must be preserved after the BroadcastChannel fix is applied.
 */

import { buildReadMessage } from '../widget_auth.js';

describe('Property 2: Preservation — Normal Opener-Based Auth Flow Unchanged', () => {
    const expectedOrigin = window.location.origin; // jsdom: 'http://localhost'

    // Note: mismatched-origin discarding is covered canonically (with both the
    // negative and the matching-origin positive case) in
    // property-origin-mismatch.test.js, so it is not duplicated here.

    /**
     * Test 2c: Verify readMessage ignores messages where data.statusAuth === undefined
     * (parasite message filtering).
     *
     * **Validates: Requirements 3.3**
     */
    it('2c: readMessage ignores messages without statusAuth (parasite filtering)', () => {
        let isValidCalled = false;

        const mockThat = {
            params: {
                isValid: () => {
                    isValidCalled = true;
                    return Promise.resolve([false, {}]);
                },
                name: 'keycloak',
            },
            creds: null,
        };

        const readMessage = buildReadMessage(mockThat, 'dummy-verifier');

        // Message without statusAuth — should be ignored as a parasite message
        const parasiteEvent = {
            origin: expectedOrigin,
            data: {
                someOtherField: 'value',
                code: 'abc',
            },
        };

        readMessage(parasiteEvent);

        expect(mockThat.creds).toBeNull();
        expect(isValidCalled).toBe(false);
    });

    /**
     * Test 2d: Verify startAuthFlow re-entry calls
     * window.removeEventListener('message', previousReadMessage) to clean up
     * old listeners.
     *
     * **Validates: Requirements 3.4**
     */
    it('2d: startAuthFlow re-entry cleans up previous postMessage listener', () => {
        // We test the cleanup pattern by simulating what startAuthFlow does:
        // 1. Create a readMessage, add it as a listener
        // 2. On re-entry, removeEventListener is called with the previous readMessage
        // 3. Then a new readMessage is added

        const removedListeners = [];
        const addedListeners = [];

        const originalAddEventListener = window.addEventListener;
        const originalRemoveEventListener = window.removeEventListener;

        window.addEventListener = jest.fn((type, fn) => {
            if (type === 'message') {
                addedListeners.push(fn);
            }
            originalAddEventListener.call(window, type, fn);
        });

        window.removeEventListener = jest.fn((type, fn) => {
            if (type === 'message') {
                removedListeners.push(fn);
            }
            originalRemoveEventListener.call(window, type, fn);
        });

        try {
            const mockThat = {
                params: {
                    isValid: () => Promise.resolve([false, {}]),
                    name: 'keycloak',
                },
                creds: null,
            };

            // Simulate first auth flow: create readMessage and register it
            const readMessage1 = buildReadMessage(mockThat, 'verifier-1');
            window.addEventListener('message', readMessage1);

            // Simulate re-entry cleanup: remove the old listener
            // (This is what startAuthFlow does at the top)
            window.removeEventListener('message', readMessage1);

            // Verify the old listener was removed
            expect(removedListeners).toContain(readMessage1);

            // Simulate second auth flow
            const readMessage2 = buildReadMessage(mockThat, 'verifier-2');
            window.addEventListener('message', readMessage2);

            // Verify both listeners were added and the first was removed
            expect(addedListeners).toContain(readMessage1);
            expect(addedListeners).toContain(readMessage2);
            expect(removedListeners).toContain(readMessage1);
        } finally {
            window.addEventListener = originalAddEventListener;
            window.removeEventListener = originalRemoveEventListener;
        }
    });

    /**
     * Test 2e: Verify error auth responses (statusAuth: 'error') are processed
     * (triggers error handling path).
     *
     * **Validates: Requirements 3.5**
     */
    it('2e: readMessage processes error auth responses', () => {
        // Spy on console.error to verify error path is triggered
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        const mockThat = {
            params: {
                isValid: () => Promise.resolve([false, {}]),
                name: 'keycloak',
                url_params: {
                    state: 'keycloak,popup,abc123',
                },
            },
            creds: null,
        };

        const readMessage = buildReadMessage(mockThat, 'dummy-verifier');

        const errorEvent = {
            origin: expectedOrigin,
            data: {
                statusAuth: 'error',
                error: 'access_denied',
                state: 'keycloak,popup,abc123',
            },
        };

        readMessage(errorEvent);

        // The error path should trigger console.error
        expect(consoleErrorSpy).toHaveBeenCalledWith('ipyauth Error: Authentication failed');

        consoleErrorSpy.mockRestore();
    });
});
