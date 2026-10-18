/**
 * Feature: jupyterlab-auth-improvements
 * Property 6: JWT payload decode/encode round-trip
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 *
 * For any valid JSON object used as a JWT payload, encoding it as a base64url
 * JWT payload segment and then decoding it with parseJwt SHALL produce an
 * object equal to the original.
 */

import fc from 'fast-check';
import util from '../widget_util.js';

const { parseJwt } = util;

/**
 * Encode a JSON object as a base64url string (mimicking JWT payload encoding).
 * Steps: JSON.stringify → UTF-8 bytes → base64 → base64url (replace +→-, /→_, strip =)
 */
function encodePayloadBase64url(obj) {
    const jsonStr = JSON.stringify(obj);
    // Handle UTF-8: unescape(encodeURIComponent(...)) produces a byte string
    const byteStr = unescape(encodeURIComponent(jsonStr));
    const base64 = btoa(byteStr);
    // Convert base64 to base64url
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build a minimal JWT string: dummyHeader.payload.dummySignature
 */
function buildFakeJwt(payloadBase64url) {
    const dummyHeader = encodePayloadBase64url({ alg: 'none' });
    const dummySignature = 'signature';
    return `${dummyHeader}.${payloadBase64url}.${dummySignature}`;
}

describe('Property 6: JWT payload decode/encode round-trip', () => {
    /**
     * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
     */
    it('parseJwt correctly round-trips any JSON-serializable object', () => {
        fc.assert(
            fc.property(fc.jsonValue(), (value) => {
                // Wrap in an object to ensure we always have a JSON object payload
                const payload = { data: value };
                const base64url = encodePayloadBase64url(payload);
                const jwt = buildFakeJwt(base64url);
                const decoded = parseJwt(jwt);
                // JSON.parse(JSON.stringify(-0)) === 0, so use JSON round-trip as
                // the canonical comparison — parseJwt does the same internally.
                const expected = JSON.parse(JSON.stringify(payload));
                expect(decoded).toEqual(expected);
            }),
            { numRuns: 100 }
        );
    });

    it('parseJwt handles payloads with base64url special characters (- and _)', () => {
        fc.assert(
            fc.property(
                fc.record({
                    // Generate strings that when base64-encoded will contain + and /
                    // which become - and _ in base64url
                    key: fc.string({ minLength: 1, maxLength: 20 }),
                    value: fc.string({ minLength: 1, maxLength: 100 }),
                }),
                (payload) => {
                    const base64url = encodePayloadBase64url(payload);
                    const jwt = buildFakeJwt(base64url);
                    const decoded = parseJwt(jwt);
                    expect(decoded).toEqual(payload);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('parseJwt handles UTF-8 encoded payloads correctly', () => {
        fc.assert(
            fc.property(
                fc.string({ unit: 'grapheme-composite', minLength: 1, maxLength: 50 }),
                (unicodeStr) => {
                    const payload = { text: unicodeStr };
                    const base64url = encodePayloadBase64url(payload);
                    const jwt = buildFakeJwt(base64url);
                    const decoded = parseJwt(jwt);
                    expect(decoded).toEqual(payload);
                }
            ),
            { numRuns: 100 }
        );
    });
});
