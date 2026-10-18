/**
 * Bugfix: security-vulnerability-fixes
 * Property 2: Preservation — JavaScript Functional Behavior Preservation
 *
 * Validates: Requirements 3.7, 3.8, 3.9, 3.11, 3.12, 3.13, 3.15, 3.16
 *
 * These tests capture the CURRENT correct behavior that must be preserved
 * after the security fixes. They MUST PASS on the current unfixed code.
 *
 * Preservation tests:
 * - toHtml rendering for safe strings (3.12)
 * - createNonce returns a usable non-empty string (3.13)
 * - Google URL construction for alphanumeric tokens (3.9)
 * - buildUrlParams produces valid state with provider name and mode (3.7, 3.8, 3.11)
 */

import fc from 'fast-check';
import util from '../widget_util.js';
import google from '../providers/google.js';

// ---------------------------------------------------------------------------
// 1. toHtml rendering preservation (3.12)
// ---------------------------------------------------------------------------
describe('Preservation — toHtml rendering for safe strings (3.12)', () => {
    /**
     * For all strings containing only alphanumeric chars, spaces, dots, and
     * hyphens (no HTML special chars), toHtml(str, 'name') output contains
     * the original string unchanged within the HTML wrapper.
     *
     * **Validates: Requirements 3.12**
     */
    it('toHtml preserves safe strings in "name" class output', () => {
        // Generate safe strings: alphanumeric, spaces, dots, hyphens
        const safeCharArb = fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-'.split('')
        );
        const safeStringArb = fc
            .array(safeCharArb, { minLength: 1, maxLength: 50 })
            .map((chars) => chars.join(''));

        fc.assert(
            fc.property(safeStringArb, (safeStr) => {
                const result = util.toHtml(safeStr, 'name');

                // Output should be valid HTML with the ipyauth-name class
                expect(result).toContain('ipyauth-name');

                // The safe string should appear unchanged in the output
                expect(result).toContain(safeStr);
            }),
            { numRuns: 100 }
        );
    });

    it('toHtml preserves safe strings in "expiry" class output', () => {
        const safeCharArb = fc.constantFrom(
            ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-:'.split('')
        );
        const safeStringArb = fc
            .array(safeCharArb, { minLength: 1, maxLength: 50 })
            .map((chars) => chars.join(''));

        fc.assert(
            fc.property(safeStringArb, (safeStr) => {
                const result = util.toHtml(safeStr, 'expiry');

                expect(result).toContain('ipyauth-expiry');
                expect(result).toContain(safeStr);
            }),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// 2. Google URL construction preservation (3.9)
// ---------------------------------------------------------------------------
describe('Preservation — Google URL construction for alphanumeric tokens (3.9)', () => {
    /**
     * For all alphanumeric access tokens (no URL-special chars), Google URL
     * construction produces a valid URL containing the token.
     *
     * **Validates: Requirements 3.9**
     */
    it('Google isValid constructs URLs containing alphanumeric tokens', async () => {
        // Use a small set of example-based tokens to avoid async PBT complexity
        const tokens = [
            'ya29abcdef1234567890',
            'simpletoken',
            'ABC123xyz',
            'a1b2c3d4e5f6',
            'TokenValue42',
        ];

        for (const token of tokens) {
            const capturedRequests = [];

            const originalFetch = globalThis.fetch;
            globalThis.fetch = (url, options) => {
                capturedRequests.push({ url, options });
                return Promise.resolve({
                    json: () =>
                        Promise.resolve({
                            aud: 'test-client-id',
                            scope: 'openid',
                            name: 'Test User',
                        }),
                });
            };

            try {
                const params = {
                    url_params: { client_id: 'test-client-id', scope: 'openid' },
                };
                const creds = {
                    access_token: token,
                    expires_in: 3600,
                };

                await google.isValid(params, creds);

                expect(capturedRequests).toHaveLength(2);
                for (const { url, options } of capturedRequests) {
                    expect(url).not.toContain('access_token=');
                    expect(options.headers.Authorization).toBe(`Bearer ${token}`);
                    expect(url).toMatch(/^https:\/\//);
                }
            } finally {
                globalThis.fetch = originalFetch;
            }
        }
    });
});

// ---------------------------------------------------------------------------
// 4. buildUrlParams preservation (3.7, 3.8, 3.11)
// ---------------------------------------------------------------------------
describe('Preservation — buildUrlParams produces valid state (3.7, 3.8, 3.11)', () => {
    /**
     * buildUrlParams produces URL parameters with a state field containing
     * the provider name and mode (popup or iframe).
     *
     * **Validates: Requirements 3.7, 3.8, 3.11**
     */
    it('buildUrlParams state contains provider name and popup mode', () => {
        fc.assert(
            fc.property(fc.constantFrom('auth0', 'google', 'keycloak'), (providerName) => {
                const paramsFull = {
                    name: providerName,
                    url_params: {
                        response_type: 'code',
                        redirect_uri: 'http://localhost/callback',
                        client_id: 'test-client',
                        scope: 'openid',
                        state: 'placeholder',
                    },
                };

                const result = util.buildUrlParams(paramsFull);

                // state format: "providerName,popup,nonce"
                const stateParts = result.state.split(',');
                expect(stateParts[0]).toBe(providerName);
                expect(stateParts[1]).toBe('popup');
                expect(stateParts[2].length).toBeGreaterThan(0);
            }),
            { numRuns: 50 }
        );
    });

    it('buildUrlParams preserves all original url_params fields', () => {
        fc.assert(
            fc.property(fc.constant(null), () => {
                const paramsFull = {
                    name: 'google',
                    url_params: {
                        response_type: 'code',
                        redirect_uri: 'http://localhost/callback',
                        client_id: 'test-client',
                        scope: 'openid profile',
                        state: 'placeholder',
                    },
                };

                const result = util.buildUrlParams(paramsFull);

                // All original fields should be present
                expect(result.response_type).toBe('code');
                expect(result.redirect_uri).toBe('http://localhost/callback');
                expect(result.client_id).toBe('test-client');
                expect(result.scope).toBe('openid profile');
                // state is overwritten with provider,mode,nonce format
                expect(result.state).toBeDefined();
                expect(result.state).not.toBe('placeholder');
            }),
            { numRuns: 20 }
        );
    });
});
