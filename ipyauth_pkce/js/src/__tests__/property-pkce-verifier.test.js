/**
 * Feature: jupyterlab-auth-improvements
 * Property 1: Code verifier format compliance
 *
 * Validates: Requirements 2.1
 *
 * For any generated code_verifier, it SHALL be between 43 and 128 characters
 * long (inclusive) and contain only unreserved URI characters ([A-Za-z0-9._~-])
 * as specified by RFC 7636.
 */

import fc from 'fast-check';
import { generateCodeVerifier, base64urlEncode } from '../widget_auth.js';

// Polyfill crypto for jsdom/Node test environment
import { webcrypto } from 'crypto';
if (!globalThis.crypto || !globalThis.crypto.getRandomValues) {
    globalThis.crypto = webcrypto;
}

describe('Property 1: Code verifier format compliance', () => {
    /**
     * **Validates: Requirements 2.1**
     */
    it('generateCodeVerifier produces a string of 43-128 unreserved URI characters', () => {
        fc.assert(
            fc.property(fc.constant(null), () => {
                const verifier = generateCodeVerifier();

                // Length must be between 43 and 128 (inclusive) per RFC 7636
                expect(verifier.length).toBeGreaterThanOrEqual(43);
                expect(verifier.length).toBeLessThanOrEqual(128);

                // Must contain only unreserved URI characters: [A-Za-z0-9._~-]
                expect(verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
            }),
            { numRuns: 100 }
        );
    });

    it('base64urlEncode produces only unreserved URI characters for any byte array', () => {
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 1, maxLength: 64 }), (bytes) => {
                const encoded = base64urlEncode(bytes);

                // base64url output must only contain [A-Za-z0-9_-] (no +, /, or =)
                expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
            }),
            { numRuns: 100 }
        );
    });
});
