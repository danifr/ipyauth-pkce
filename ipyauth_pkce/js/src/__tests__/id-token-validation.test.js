import fc from 'fast-check';
import util from '../widget_util.js';
import providers from '../providers/index.js';

const { auth0, google } = providers;

const now = Math.floor(Date.now() / 1000);
const validClaims = {
    iss: 'https://tenant.example.com/',
    aud: 'client-id',
    sub: 'user-123',
    exp: now + 300,
    iat: now - 10,
    nonce: 'nonce-123',
};

const expectedClaims = {
    issuer: validClaims.iss,
    audience: validClaims.aud,
    nonce: validClaims.nonce,
};

const encodeBase64url = (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const buildProviderClaims = (overrides) => ({
    ...validClaims,
    ...overrides,
});

describe('ID-token claim validation', () => {
    it('accepts valid issuer, audience, subject, expiry, issued-at, and nonce claims', () => {
        expect(util.validateIdTokenClaims(validClaims, expectedClaims)).toBe(true);
    });

    it('rejects malformed or invalid required claims', () => {
        fc.assert(
            fc.property(
                fc.constantFrom(
                    { iss: 'https://attacker.example.com/' },
                    { aud: 'different-client' },
                    { sub: '' },
                    { exp: now - 61 },
                    { iat: now + 61 },
                    { nonce: 'different-nonce' }
                ),
                (override) => {
                    expect(
                        util.validateIdTokenClaims(buildProviderClaims(override), expectedClaims)
                    ).toBe(false);
                }
            ),
            { numRuns: 20 }
        );
    });

    it('accepts an audience array containing the configured client', () => {
        expect(
            util.validateIdTokenClaims(
                buildProviderClaims({ aud: ['other-client', 'client-id'] }),
                expectedClaims
            )
        ).toBe(true);
    });

    it('rejects an issued-at claim later than expiry', () => {
        expect(
            util.validateIdTokenClaims(
                buildProviderClaims({ exp: now + 100, iat: now + 101 }),
                expectedClaims
            )
        ).toBe(false);
    });
});

describe('ID-token JWKS signature validation', () => {
    it('verifies an RS256 signature and rejects a tampered payload', async () => {
        const keyPair = await crypto.subtle.generateKey(
            {
                name: 'RSASSA-PKCS1-v1_5',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256',
            },
            true,
            ['sign', 'verify']
        );
        const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key' };
        const headerPart = encodeBase64url(header);
        const payloadPart = encodeBase64url(validClaims);
        const signingInput = `${headerPart}.${payloadPart}`;
        const signature = await crypto.subtle.sign(
            { name: 'RSASSA-PKCS1-v1_5' },
            keyPair.privateKey,
            new TextEncoder().encode(signingInput)
        );
        let signatureBinary = '';
        for (const byte of new Uint8Array(signature)) {
            signatureBinary += String.fromCharCode(byte);
        }
        const signaturePart = btoa(signatureBinary)
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const token = `${signingInput}.${signaturePart}`;
        const jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] }),
        });

        try {
            await expect(
                util.validateIdToken(
                    validClaims,
                    { ...expectedClaims, jwksUrl: 'https://issuer.example/.well-known/jwks.json' },
                    token
                )
            ).resolves.toBe(true);

            const tamperedToken = `${headerPart}.${encodeBase64url({ ...validClaims, sub: 'tampered' })}.${signaturePart}`;
            await expect(
                util.verifyIdTokenSignature(
                    tamperedToken,
                    'https://issuer.example/.well-known/jwks.json'
                )
            ).resolves.toBe(false);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://issuer.example/.well-known/jwks.json',
                expect.objectContaining({ cache: 'no-store' })
            );
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

describe('Provider ID-token validation', () => {
    it('Auth0 rejects an ID token with the wrong issuer', async () => {
        const params = {
            authorize_endpoint: 'https://tenant.example.com/authorize',
            url_params: {
                client_id: 'client-id',
                nonce: 'nonce-123',
                scope: 'openid profile',
            },
        };
        const creds = {
            id_token: buildProviderClaims({ iss: 'https://attacker.example.com/' }),
            expires_in: 300,
        };

        const [valid] = await auth0.isValid(params, creds);
        expect(valid).toBe(false);
    });

    it('Google rejects an ID token with an expired claim', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn().mockResolvedValue({
            json: () => Promise.resolve({ aud: 'client-id', name: 'Test User' }),
        });
        const params = {
            url_params: { client_id: 'client-id', nonce: 'nonce-123', scope: 'openid profile' },
        };
        const creds = {
            access_token: 'access-token',
            expires_in: 300,
            id_token: buildProviderClaims({
                iss: 'https://accounts.google.com',
                exp: now - 61,
            }),
        };

        try {
            const [valid] = await google.isValid(params, creds);
            expect(valid).toBe(false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
