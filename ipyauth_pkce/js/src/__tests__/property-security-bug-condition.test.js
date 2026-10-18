/**
 * Bugfix: security-vulnerability-fixes
 * Property 1: Bug Condition — JavaScript Security Vulnerabilities
 *
 * Validates: Requirements 1.7, 1.8, 1.9, 1.13, 1.14
 *
 * These tests MUST FAIL on unfixed code — failure confirms the bugs exist.
 * DO NOT attempt to fix the test or the code when it fails.
 *
 * Bug conditions tested:
 * - XSS in toHtml (1.8): raw HTML interpolated without escaping
 * - Weak nonce (1.9): Math.random() produces only 10 lowercase letters (~47 bits)
 * - Bearer token URL exposure (1.7): Google sends tokens in request URLs
 * - Implicit flow fallback (1.13): readMessage processes tokens without code field
 * - Unvalidated params (1.14): getDataFromCallbackUrl() accepts any length/content
 */

import fc from 'fast-check';
import util from '../widget_util.js';
import google from '../providers/google.js';
import { buildReadMessage } from '../widget_auth.js';
// Import the REAL callback URL parser so this validation is tested against the
// shipped code, not a copy.
const { getDataFromCallbackUrl } = require('../../../ipyauth_callback/templates/assets/util.js');

// ---------------------------------------------------------------------------
// 1. XSS in toHtml (1.8)
// ---------------------------------------------------------------------------
describe('Bug Condition — XSS in toHtml (1.8)', () => {
    /**
     * For any string containing HTML special characters (<, >, &, ", '),
     * toHtml() output SHALL have all such characters escaped.
     * On unfixed code, raw HTML is interpolated → test FAILS.
     *
     * **Validates: Requirements 1.8**
     */
    it('toHtml escapes all HTML special characters in the output', () => {
        fc.assert(
            fc.property(
                // Generate strings that always contain at least one HTML special char
                fc
                    .tuple(
                        fc.string({ minLength: 0, maxLength: 20 }),
                        fc.constantFrom('<', '>', '&', '"', "'"),
                        fc.string({ minLength: 0, maxLength: 20 })
                    )
                    .map(([prefix, special, suffix]) => prefix + special + suffix),
                (input) => {
                    const result = util.toHtml(input, 'name');

                    // Extract the content inside the <div class="ipyauth-name">...</div>
                    const divMatch = result.match(/<div class="ipyauth-name">([\s\S]*?)<\/div>/);
                    expect(divMatch).not.toBeNull();
                    const content = divMatch[1];

                    // The raw input must NOT appear verbatim inside the div
                    // when it contains HTML special chars. Instead, the special
                    // chars should be escaped (&lt; &gt; &amp; &quot; &#x27;).
                    //
                    // On UNFIXED code: the input is interpolated raw, so the
                    // content equals the input → this assertion FAILS.
                    if (input.includes('&')) {
                        // & must be escaped as &amp;
                        expect(content).toContain('&amp;');
                    }
                    if (input.includes('<')) {
                        // < must be escaped as &lt;
                        expect(content).toContain('&lt;');
                    }
                    if (input.includes('>')) {
                        // > must be escaped as &gt;
                        expect(content).toContain('&gt;');
                    }
                    if (input.includes('"')) {
                        // " must be escaped as &quot;
                        expect(content).toContain('&quot;');
                    }
                    if (input.includes("'")) {
                        // ' must be escaped as &#x27;
                        expect(content).toContain('&#x27;');
                    }
                }
            ),
            { numRuns: 100 }
        );
    });
});

// ---------------------------------------------------------------------------
// 2. Weak nonce (1.9)
// ---------------------------------------------------------------------------
describe('Bug Condition — Weak Nonce Generation (1.9)', () => {
    /**
     * createNonce() SHALL return a string of at least 32 characters
     * (128 bits encoded as hex). On unfixed code, returns only 10
     * lowercase letters from Math.random() → length check FAILS.
     *
     * Since createNonce is not directly exported, we test it via
     * buildUrlParams which calls createNonce internally and embeds
     * the nonce as the third component of the state parameter.
     *
     * **Validates: Requirements 1.9**
     */
    it('nonce in buildUrlParams state is at least 32 characters', () => {
        fc.assert(
            fc.property(fc.constant(null), () => {
                const paramsFull = {
                    name: 'google',
                    url_params: {
                        response_type: 'code',
                        redirect_uri: 'http://localhost/callback',
                        client_id: 'test-client',
                        scope: 'openid',
                        state: 'placeholder',
                    },
                };

                const result = util.buildUrlParams(paramsFull);
                // state format: "providerName,popup|iframe,nonce"
                const stateParts = result.state.split(',');
                const nonce = stateParts[2];

                expect(typeof nonce).toBe('string');
                // On unfixed code: nonce is 10 lowercase letters → FAILS
                expect(nonce.length).toBeGreaterThanOrEqual(32);
            }),
            { numRuns: 50 }
        );
    });
});

// ---------------------------------------------------------------------------
// 3. Google bearer token URL exposure (1.7)
// ---------------------------------------------------------------------------
describe('Bug Condition — Google Bearer Token URL Exposure (1.7)', () => {
    /**
     * For access tokens containing URL-special characters (&, ?, #, =, space),
     * the Google provider's isValid() SHALL send the token in an Authorization
     * header and keep it out of API URLs.
     *
     * We mock fetch to capture the URLs that isValid() constructs.
     *
     * **Validates: Requirements 1.7**
     */
    it('Google isValid sends special-character tokens in Authorization headers', async () => {
        const specialTokens = [
            'tok&evil=1',
            'tok?extra=param',
            'tok#fragment',
            'tok with spaces',
            'tok=equals',
        ];

        for (const token of specialTokens) {
            const capturedRequests = [];

            // Mock fetch to capture URLs and request options
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
                }
            } finally {
                globalThis.fetch = originalFetch;
            }
        }
    });
});

// ---------------------------------------------------------------------------
// 4. Implicit flow fallback (1.13)
// ---------------------------------------------------------------------------
describe('Bug Condition — Implicit Flow Fallback (1.13)', () => {
    /**
     * When callback data has statusAuth='ok' and access_token but NO code,
     * the system SHALL reject it (not process via implicit flow).
     * On unfixed code, the implicit flow branch processes the data and
     * calls isValid → test FAILS because isValidCalled becomes true.
     *
     * **Validates: Requirements 1.13**
     */
    it('rejects callback data without code field (no implicit flow fallback)', (done) => {
        let isValidCalled = false;

        const mockThat = {
            params: {
                isValid: () => {
                    isValidCalled = true;
                    return Promise.resolve([
                        true,
                        {
                            username: 'test',
                            expiry: new Date(Date.now() + 3600000),
                            access_token: 'implicit-token',
                            scope: 'openid',
                        },
                    ]);
                },
                name: 'google',
                url_params: {
                    redirect_uri: 'http://localhost/callback',
                    client_id: 'test-client',
                },
                token_endpoint: 'https://oauth2.googleapis.com/token',
            },
            creds: null,
            model: {
                get: () => ({}),
                set: () => {},
                save_changes: () => {},
            },
            form: {
                btn_main: { model: { set_state: () => {} } },
                logged_as: { model: { set: () => {} } },
                expires_at: { model: { set: () => {} } },
                time_to_exp: { model: { set: () => {} } },
            },
        };

        // Build readMessage — this sets up the processAuthMessage logic
        const readMessage = buildReadMessage(mockThat, 'test-verifier');

        // Simulate a postMessage event with access_token but NO code
        // This is the implicit flow scenario
        const fakeEvent = {
            origin: window.location.origin,
            data: {
                statusAuth: 'ok',
                access_token: 'implicit-flow-token-12345',
                state: 'google,popup,testnonce',
                // NOTE: no 'code' field — this is the implicit flow case
            },
        };

        // Dispatch the message
        readMessage(fakeEvent);

        // Give async processing time to complete
        setTimeout(() => {
            try {
                // On UNFIXED code: isValid IS called because the implicit flow
                // branch processes the data. We expect it NOT to be called
                // (the response should be rejected).
                expect(isValidCalled).toBe(false);
                done();
            } catch (err) {
                done(err);
            }
        }, 200);
    });
});

// ---------------------------------------------------------------------------
// 5. Unvalidated callback params (1.14)
// ---------------------------------------------------------------------------
describe('Bug Condition — Unvalidated Callback Parameters (1.14)', () => {
    /**
     * getDataFromCallbackUrl() SHALL reject parameters exceeding 4096 chars
     * or containing null bytes. Tested against the real callback util.js via
     * its CommonJS export.
     *
     * **Validates: Requirements 1.14**
     */

    it('rejects parameters exceeding 4096 characters', () => {
        const longValue = 'a'.repeat(5000);
        const testUrl = `http://localhost/callback?code=${longValue}&state=google,popup,nonce`;

        const data = getDataFromCallbackUrl(testUrl);

        // On FIXED code: the long code param should be filtered out
        // On UNFIXED code: the long value is accepted → this FAILS
        expect(data.code).toBeUndefined();
    });

    it('rejects parameters containing null bytes', () => {
        const nullValue = 'valid_code\x00injected';
        const testUrl = `http://localhost/callback?code=${encodeURIComponent(nullValue)}&state=google,popup,nonce`;

        const data = getDataFromCallbackUrl(testUrl);

        // On FIXED code: the code with null byte should be filtered out
        // On UNFIXED code: the null byte value is accepted → this FAILS
        expect(data.code).toBeUndefined();
    });

    it('rejects any parameter value exceeding 4096 characters (PBT)', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 4097, maxLength: 6000 }), (longValue) => {
                const testUrl = `http://localhost/callback?code=${encodeURIComponent(longValue)}&state=google,popup,nonce`;
                const data = getDataFromCallbackUrl(testUrl);

                // On FIXED code: oversized values are filtered out
                // On UNFIXED code: the value is accepted → FAILS
                expect(data.code).toBeUndefined();
            }),
            { numRuns: 20 }
        );
    });
});
