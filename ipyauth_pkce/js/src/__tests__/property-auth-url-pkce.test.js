/**
 * Feature: jupyterlab-auth-improvements
 * Property 3: Authorization URL includes PKCE parameters
 *
 * Validates: Requirements 2.3
 *
 * For any valid provider configuration, the authorization URL built by
 * buildAuthorizeUrl SHALL contain the query parameters response_type=code,
 * code_challenge (non-empty), and code_challenge_method=S256.
 */

import fc from 'fast-check';
import util from '../widget_util.js';

/**
 * Arbitrary that generates a valid base64url-encoded code_challenge string
 * (SHA-256 digest is always 32 bytes → 43 base64url chars).
 */
const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const codeChallengeArb = fc
    .array(fc.integer({ min: 0, max: BASE64URL_CHARS.length - 1 }), {
        minLength: 43,
        maxLength: 43,
    })
    .map((indices) => indices.map((i) => BASE64URL_CHARS[i]).join(''));

/**
 * Arbitrary that generates a valid provider paramsFull object with PKCE params set.
 */
const paramsFullArb = fc
    .record({
        name: fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/),
        authorize_endpoint: fc.constantFrom(
            'https://accounts.example.com/authorize',
            'https://idp.test.org/auth',
            'https://keycloak.local/realms/myrealm/protocol/openid-connect/auth'
        ),
        codeChallenge: codeChallengeArb,
        clientId: fc.stringMatching(/^[a-zA-Z0-9_-]{4,32}$/),
        redirectUri: fc.constantFrom(
            'https://localhost:8888/callback',
            'https://jupyter.example.com/callback'
        ),
        scope: fc.constantFrom('openid', 'openid profile', 'openid profile email'),
    })
    .map(({ name, authorize_endpoint, codeChallenge, clientId, redirectUri, scope }) => ({
        name,
        authorize_endpoint,
        url_params: {
            response_type: 'code',
            client_id: clientId,
            redirect_uri: redirectUri,
            scope,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        },
    }));

describe('Property 3: Authorization URL includes PKCE parameters', () => {
    /**
     * **Validates: Requirements 2.3**
     */
    it('buildAuthorizeUrl output contains response_type=code, code_challenge, and code_challenge_method=S256', () => {
        fc.assert(
            fc.property(paramsFullArb, (paramsFull) => {
                // Run through buildUrlParams first (as startAuthFlow does)
                const processedParams = util.buildUrlParams(paramsFull);
                const processedFull = { ...paramsFull, url_params: processedParams };

                const authUrl = util.buildAuthorizeUrl(processedFull);

                // Parse the URL query string
                const urlObj = new URL(authUrl);
                const params = urlObj.searchParams;

                // response_type must be 'code'
                expect(params.get('response_type')).toBe('code');

                // code_challenge must be present and non-empty
                const challenge = params.get('code_challenge');
                expect(challenge).toBeTruthy();
                expect(challenge.length).toBeGreaterThan(0);

                // code_challenge_method must be 'S256'
                expect(params.get('code_challenge_method')).toBe('S256');
            }),
            { numRuns: 100 }
        );
    });

    it('PKCE params survive buildUrlParams processing without being dropped or altered', () => {
        fc.assert(
            fc.property(paramsFullArb, (paramsFull) => {
                const originalChallenge = paramsFull.url_params.code_challenge;

                const processed = util.buildUrlParams(paramsFull);

                // code_challenge must be preserved exactly
                expect(processed.code_challenge).toBe(originalChallenge);
                expect(processed.code_challenge_method).toBe('S256');
                expect(processed.response_type).toBe('code');
            }),
            { numRuns: 100 }
        );
    });

    it('always sets a fresh random nonce that is also the unguessable part of the state', () => {
        fc.assert(
            fc.property(paramsFullArb, (paramsFull) => {
                const a = util.buildUrlParams(paramsFull);
                const b = util.buildUrlParams(paramsFull);

                expect(a.nonce).toMatch(/^[0-9a-f]{32}$/);
                expect(a.nonce).not.toBe(b.nonce);
                expect(a.state).toBe(`${paramsFull.name},popup,${a.nonce}`);
                // The caller's object is not mutated.
                expect(paramsFull.url_params.nonce).toBeUndefined();
            }),
            { numRuns: 50 }
        );
    });
});
