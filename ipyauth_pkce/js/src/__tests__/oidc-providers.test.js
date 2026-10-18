/**
 * Auth0 and Keycloak isValid(): issuer/JWKS derivation, username claim, scope
 * default, and expiry (the earlier of access-token and ID-token expiry).
 */
import auth0 from '../providers/auth0.js';
import keycloak from '../providers/keycloak.js';

const NOW = 1_800_000_000_000;

const claims = (iss, overrides = {}) => ({
    iss,
    aud: 'cid',
    sub: 'user-1',
    nonce: 'n',
    iat: NOW / 1000 - 10,
    exp: NOW / 1000 + 3600,
    ...overrides,
});

const CASES = {
    auth0: {
        provider: auth0,
        params: { authorize_endpoint: 'https://t.auth0.com/authorize' },
        issuer: 'https://t.auth0.com/',
        jwks: 'https://t.auth0.com/.well-known/jwks.json',
        username: [
            [{ nickname: 'nick', email: 'e@x' }, 'nick'],
            [{ email: 'e@x' }, 'e@x'],
            [{}, 'user-1'],
        ],
    },
    keycloak: {
        provider: keycloak,
        params: {
            authorize_endpoint: 'https://kc.example.com/realms/r/protocol/openid-connect/auth',
        },
        issuer: 'https://kc.example.com/realms/r',
        jwks: 'https://kc.example.com/realms/r/protocol/openid-connect/certs',
        username: [
            [{ email: 'e@x', nickname: 'nick' }, 'e@x'],
            [{}, undefined],
        ],
    },
};

const paramsFor = (c) => ({
    ...c.params,
    url_params: { client_id: 'cid', nonce: 'n', scope: 'openid profile' },
});

describe.each(Object.keys(CASES))('%s isValid', (name) => {
    const c = CASES[name];
    let fetchMock;

    beforeEach(() => {
        jest.spyOn(Date, 'now').mockReturnValue(NOW);
        fetchMock = jest.fn().mockResolvedValue({ ok: false });
        globalThis.fetch = fetchMock;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete globalThis.fetch;
    });

    it.each(c.username)('accepts valid claims; username from %j', async (extra, expected) => {
        const [ok, creds] = await c.provider.isValid(paramsFor(c), {
            id_token: claims(c.issuer, extra),
            expires_in: 300,
        });
        expect(ok).toBe(true);
        expect(creds.username).toBe(expected);
        expect(creds.scope).toBe('openid profile');
        expect(creds.expiry).toEqual(new Date(NOW + 300 * 1000));
    });

    it('keeps a granted scope and uses the ID-token expiry when it is earlier', async () => {
        const [ok, creds] = await c.provider.isValid(paramsFor(c), {
            id_token: claims(c.issuer, { exp: NOW / 1000 + 60 }),
            expires_in: 300,
            scope: 'openid',
        });
        expect(ok).toBe(true);
        expect(creds.scope).toBe('openid');
        expect(creds.expiry).toEqual(new Date(NOW + 60 * 1000));
    });

    it('uses the ID-token expiry when expires_in is absent', async () => {
        const [, creds] = await c.provider.isValid(paramsFor(c), {
            id_token: claims(c.issuer),
        });
        expect(creds.expiry).toEqual(new Date(NOW + 3600 * 1000));
    });

    it('rejects a missing ID token, wrong issuer, or wrong nonce', async () => {
        const p = paramsFor(c);
        expect((await c.provider.isValid(p, {}))[0]).toBe(false);
        expect(
            (await c.provider.isValid(p, { id_token: claims('https://evil.example/') }))[0]
        ).toBe(false);
        expect(
            (await c.provider.isValid(p, { id_token: claims(c.issuer, { nonce: 'other' }) }))[0]
        ).toBe(false);
    });

    it('verifies the raw token signature against the provider JWKS URL', async () => {
        const [ok] = await c.provider.isValid(paramsFor(c), {
            id_token: claims(c.issuer),
            id_token_raw: 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.e30.c2ln',
        });
        expect(ok).toBe(false);
        expect(fetchMock).toHaveBeenCalledWith(c.jwks, expect.anything());
    });

    it('honors an explicit params.issuer', async () => {
        const [ok] = await c.provider.isValid(
            { ...paramsFor(c), issuer: 'https://custom.example' },
            { id_token: claims('https://custom.example') }
        );
        expect(ok).toBe(true);
    });
});
