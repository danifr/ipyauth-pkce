/**
 * Feature: jupyterlab-auth-improvements
 * Property 9: Keycloak audience validation
 *
 * Validates: Requirements 11.4
 *
 * For any Keycloak token response and configured client_id, the isValid function
 * SHALL return [false, ...] when the token's aud claim does not match the client_id,
 * and [true, ...] when it does match.
 */

import fc from 'fast-check';
import idProviders from '../providers/index';

const { keycloak } = idProviders;
const KEYCLOAK_ISSUER = 'https://keycloak.example.com/realms/test';

/**
 * Helper to build a minimal creds object for Keycloak isValid.
 */
function buildCreds(aud, nonce) {
    return {
        id_token: {
            iss: KEYCLOAK_ISSUER,
            aud,
            sub: 'user-123',
            exp: Math.floor(Date.now() / 1000) + 300,
            iat: Math.floor(Date.now() / 1000) - 10,
            nonce,
            email: 'user@example.com',
        },
        expires_in: 300,
        scope: null,
    };
}

describe('Property 9: Keycloak audience validation', () => {
    /**
     * **Validates: Requirements 11.4**
     */
    it('returns [false, creds] when aud (string) does not match client_id', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }),
                fc.string({ minLength: 1, maxLength: 50 }),
                fc.string({ minLength: 1, maxLength: 20 }),
                async (clientId, differentAud, nonce) => {
                    fc.pre(clientId !== differentAud);

                    const params = {
                        url_params: { ...keycloak.url_params, client_id: clientId, nonce },
                        issuer: KEYCLOAK_ISSUER,
                    };
                    const creds = buildCreds(differentAud, nonce);

                    const [valid] = await keycloak.isValid(params, creds);
                    expect(valid).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('returns [true, creds] when aud (string) matches client_id and nonce matches', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }),
                fc.string({ minLength: 1, maxLength: 20 }),
                async (clientId, nonce) => {
                    const params = {
                        url_params: { ...keycloak.url_params, client_id: clientId, nonce },
                        issuer: KEYCLOAK_ISSUER,
                    };
                    const creds = buildCreds(clientId, nonce);

                    const [valid] = await keycloak.isValid(params, creds);
                    expect(valid).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('returns [false, creds] when aud (array) does not include client_id', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }),
                fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
                    minLength: 1,
                    maxLength: 5,
                }),
                fc.string({ minLength: 1, maxLength: 20 }),
                async (clientId, audArray, nonce) => {
                    // Ensure client_id is not in the array
                    const filteredAud = audArray.filter((a) => a !== clientId);
                    fc.pre(filteredAud.length > 0);

                    const params = {
                        url_params: { ...keycloak.url_params, client_id: clientId, nonce },
                        issuer: KEYCLOAK_ISSUER,
                    };
                    const creds = buildCreds(filteredAud, nonce);

                    const [valid] = await keycloak.isValid(params, creds);
                    expect(valid).toBe(false);
                }
            ),
            { numRuns: 100 }
        );
    });

    it('returns [true, creds] when aud (array) includes client_id and nonce matches', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.string({ minLength: 1, maxLength: 50 }),
                fc.array(fc.string({ minLength: 1, maxLength: 50 }), {
                    minLength: 0,
                    maxLength: 4,
                }),
                fc.string({ minLength: 1, maxLength: 20 }),
                async (clientId, otherAuds, nonce) => {
                    // Include client_id in the array
                    const audArray = [...otherAuds, clientId];

                    const params = {
                        url_params: { ...keycloak.url_params, client_id: clientId, nonce },
                        issuer: KEYCLOAK_ISSUER,
                    };
                    const creds = buildCreds(audArray, nonce);

                    const [valid] = await keycloak.isValid(params, creds);
                    expect(valid).toBe(true);
                }
            ),
            { numRuns: 100 }
        );
    });
});
