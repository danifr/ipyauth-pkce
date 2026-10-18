/**
 * Feature: jupyterlab-auth-improvements
 * Property 2: Code challenge is SHA-256 of code verifier
 *
 * Validates: Requirements 2.2
 *
 * For any code_verifier string (43-128 unreserved URI characters), the computed
 * code_challenge SHALL equal the base64url-encoding (without padding) of the
 * SHA-256 digest of the code_verifier's UTF-8 byte representation.
 *
 * @jest-environment-options {"customExportConditions": ["node"]}
 */

import { createHash } from 'crypto';
import fc from 'fast-check';
import { generateCodeChallenge, generateCodeVerifier } from '../widget_auth.js';

/**
 * Independent reference implementation: SHA-256 + base64url using Node's crypto.
 */
function referenceSha256Base64url(input) {
    const hash = createHash('sha256').update(input, 'utf8').digest();
    return Buffer.from(hash)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Arbitrary that generates valid code_verifier strings:
 * 43-128 characters from the unreserved URI character set [A-Za-z0-9._~-].
 */
const UNRESERVED_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-';
const codeVerifierArb = fc
    .array(fc.integer({ min: 0, max: UNRESERVED_CHARS.length - 1 }), {
        minLength: 43,
        maxLength: 128,
    })
    .map((indices) => indices.map((i) => UNRESERVED_CHARS[i]).join(''));

describe('Property 2: Code challenge is SHA-256 of code verifier', () => {
    /**
     * **Validates: Requirements 2.2**
     */
    it('generateCodeChallenge matches independent SHA-256 + base64url for any valid verifier', () => {
        fc.assert(
            fc.asyncProperty(codeVerifierArb, async (verifier) => {
                const challenge = await generateCodeChallenge(verifier);
                const expected = referenceSha256Base64url(verifier);

                expect(challenge).toBe(expected);
            }),
            { numRuns: 100 }
        );
    });

    it('generateCodeChallenge matches reference for verifiers produced by generateCodeVerifier', () => {
        fc.assert(
            fc.asyncProperty(fc.constant(null), async () => {
                const verifier = generateCodeVerifier();
                const challenge = await generateCodeChallenge(verifier);
                const expected = referenceSha256Base64url(verifier);

                expect(challenge).toBe(expected);
            }),
            { numRuns: 100 }
        );
    });
});
