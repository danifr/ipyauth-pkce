/**
 * Direct tests for the OAuth callback page logic
 * (ipyauth_callback/templates/assets/util.js).
 *
 * These import the REAL callback code via its dual-mode (CommonJS) export,
 * rather than reimplementing it, so a regression in the shipped callback file
 * is caught here. The callback file is a classic <script> in the browser; the
 * module.exports footer only activates under a CommonJS runner like Jest.
 */
const callbackUtil = require('../../../ipyauth_callback/templates/assets/util.js');

const {
    getDataFromCallbackUrl,
    containsError,
    sendMessageToParent,
    buildCallbackMessage,
    getBroadcastChannelName,
} = callbackUtil;

describe('callback util.js — real shipped code', () => {
    describe('containsError', () => {
        it('accepts a valid code+state callback', () => {
            expect(containsError({ code: 'abc', state: 'google,popup,n' })).toBe(false);
        });
        it('rejects an OAuth error response', () => {
            expect(containsError({ error: 'access_denied', state: 's' })).toBe(true);
        });
        it('rejects implicit-flow token responses (access_token / id_token)', () => {
            expect(containsError({ access_token: 'x', state: 's' })).toBe(true);
            expect(containsError({ id_token: 'x', state: 's' })).toBe(true);
        });
        it('rejects a missing or empty code', () => {
            expect(containsError({ state: 's' })).toBe(true);
            expect(containsError({ code: '', state: 's' })).toBe(true);
        });
        it('rejects a missing state', () => {
            expect(containsError({ code: 'abc' })).toBe(true);
        });
    });

    describe('getDataFromCallbackUrl (href argument)', () => {
        it('parses query-string params', () => {
            const data = getDataFromCallbackUrl(
                'http://localhost/callback?code=abc&state=google,popup,n'
            );
            expect(data.code).toBe('abc');
            expect(data.state).toBe('google,popup,n');
        });

        it('rejects parameters exceeding 4096 characters', () => {
            const long = 'a'.repeat(5000);
            const data = getDataFromCallbackUrl(
                `http://localhost/callback?code=${long}&state=google,popup,n`
            );
            expect(data.code).toBeUndefined();
        });

        it('rejects parameters containing control characters', () => {
            const nullValue = encodeURIComponent('abc\x00def');
            const data = getDataFromCallbackUrl(
                `http://localhost/callback?code=${nullValue}&state=google,popup,n`
            );
            expect(data.code).toBeUndefined();
        });

        it('falls back to window.location.href when no argument is given', () => {
            // jsdom default href has no query/fragment → empty object.
            expect(getDataFromCallbackUrl()).toEqual({});
        });
    });

    describe('buildCallbackMessage (state validation + discrimination)', () => {
        it('returns state_mismatch when states differ', () => {
            const { kind, objMsg } = buildCallbackMessage(
                { code: 'abc', state: 'attacker' },
                'expected'
            );
            expect(kind).toBe('state_mismatch');
            expect(objMsg.statusAuth).toBe('error');
            expect(objMsg.error).toBe('state_mismatch');
        });

        it('returns state_mismatch when expectedState is missing', () => {
            const { kind } = buildCallbackMessage({ code: 'abc', state: 's' }, null);
            expect(kind).toBe('state_mismatch');
        });

        it('returns error and forwards only safe fields on an OAuth error', () => {
            const { kind, objMsg } = buildCallbackMessage(
                {
                    state: 's',
                    error: 'access_denied',
                    error_description: 'user said no',
                    secret: 'should-not-forward',
                },
                's'
            );
            expect(kind).toBe('error');
            expect(objMsg.error).toBe('access_denied');
            expect(objMsg.error_description).toBe('user said no');
            expect(objMsg.secret).toBeUndefined();
        });

        it('rejects implicit-flow token response as an error (no code)', () => {
            const { kind } = buildCallbackMessage({ state: 's', access_token: 'leaked' }, 's');
            expect(kind).toBe('error');
        });

        it('returns ok with code+state on a valid authorization-code callback', () => {
            const { kind, objMsg } = buildCallbackMessage({ code: 'the-code', state: 's' }, 's');
            expect(kind).toBe('ok');
            expect(objMsg).toEqual({ statusAuth: 'ok', code: 'the-code', state: 's' });
        });
    });

    describe('getBroadcastChannelName', () => {
        it('derives a per-state channel name', () => {
            expect(getBroadcastChannelName('google,popup,abc')).toBe(
                'ipyauth-google%2Cpopup%2Cabc'
            );
        });
        it('returns null for empty/invalid state', () => {
            expect(getBroadcastChannelName('')).toBeNull();
            expect(getBroadcastChannelName(null)).toBeNull();
        });
    });

    describe('sendMessageToParent', () => {
        it('posts to window.opener with the opener origin when available', () => {
            const postMessage = jest.fn();
            const win = {
                opener: { origin: 'http://localhost', postMessage },
                location: { origin: 'http://localhost' },
            };
            sendMessageToParent(win, { statusAuth: 'ok', code: 'c', state: 's' });
            expect(postMessage).toHaveBeenCalledWith(
                { statusAuth: 'ok', code: 'c', state: 's' },
                'http://localhost'
            );
        });

        it('does not throw when there is no opener (BroadcastChannel fallback)', () => {
            const win = { opener: null, location: { origin: 'http://localhost' } };
            expect(() =>
                sendMessageToParent(win, { statusAuth: 'ok', code: 'c', state: 's' })
            ).not.toThrow();
        });
    });
});
