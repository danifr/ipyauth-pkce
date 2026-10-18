/**
 * The authorize URL sent to each provider, built from the exact params the
 * Python Params* classes produce (see ParamsGoogle/ParamsKeycloak/ParamsAuth0
 * .data). Pins the full query so template/merge refactors cannot silently add,
 * drop, or alter parameters.
 */
import auth from '../widget_auth.js';

const REDIRECT = 'http://localhost:8888/callback/';

const PYTHON_PARAMS = {
    google: {
        name: 'google',
        token_endpoint: 'https://oauth2.googleapis.com/token',
        url_params: {
            response_type: 'code',
            client_id: 'gid',
            redirect_uri: REDIRECT,
            scope: 'openid profile email',
            include_granted_scopes: 'false',
        },
    },
    keycloak: {
        name: 'keycloak',
        authorize_endpoint: 'https://kc.example.com/realms/r/protocol/openid-connect/auth',
        token_endpoint: 'https://kc.example.com/realms/r/protocol/openid-connect/token',
        url_params: {
            response_type: 'code',
            client_id: 'kid',
            redirect_uri: REDIRECT,
            scope: 'openid profile',
        },
    },
    auth0: {
        name: 'auth0',
        authorize_endpoint: 'https://t.auth0.com/authorize',
        token_endpoint: 'https://t.auth0.com/oauth/token',
        url_params: {
            response_type: 'code',
            client_id: 'aid',
            redirect_uri: REDIRECT,
            scope: 'openid profile',
        },
    },
};

const EXPECTED = {
    google: {
        base: 'https://accounts.google.com/o/oauth2/v2/auth',
        params: {
            access_type: 'online',
            client_id: 'gid',
            redirect_uri: REDIRECT,
            scope: 'openid profile email',
            include_granted_scopes: 'false',
        },
    },
    keycloak: {
        base: 'https://kc.example.com/realms/r/protocol/openid-connect/auth',
        params: { client_id: 'kid', redirect_uri: REDIRECT, scope: 'openid profile' },
    },
    auth0: {
        base: 'https://t.auth0.com/authorize',
        params: { client_id: 'aid', redirect_uri: REDIRECT, scope: 'openid profile' },
    },
};

const authorizeUrlFor = async (params) => {
    const replace = jest.fn();
    const popup = { close: jest.fn(), closed: false, location: { replace } };
    const open = jest.spyOn(window, 'open').mockImplementation(() => popup);
    const that = { model: { get: (k) => (k === 'params' ? params : undefined) } };
    try {
        await auth.login(that);
    } finally {
        open.mockRestore();
    }
    // Stop the popup-close poll started by the flow.
    popup.closed = true;
    return new URL(replace.mock.calls[0][0]);
};

describe('authorize URL per provider', () => {
    it.each(Object.keys(PYTHON_PARAMS))('%s', async (name) => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
        try {
            const url = await authorizeUrlFor(PYTHON_PARAMS[name]);
            const query = Object.fromEntries(url.searchParams.entries());
            const { nonce, state, code_challenge, ...rest } = query;

            expect(`${url.origin}${url.pathname}`).toBe(EXPECTED[name].base);
            expect(rest).toEqual({
                ...EXPECTED[name].params,
                response_type: 'code',
                code_challenge_method: 'S256',
            });
            expect(nonce).toMatch(/^[0-9a-f]{32}$/);
            expect(state).toBe(`${name},popup,${nonce}`);
            expect(code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });
});
