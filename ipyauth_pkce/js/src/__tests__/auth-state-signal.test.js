/**
 * The widget publishes where the sign-in stands via the synced `auth_state`
 * trait, so a blocking caller (e.g. obi-auth's notebook flow) can wait only
 * while a sign-in is actually happening:
 *   'idle' -> 'in_progress' (popup open) -> 'signed_in' | 'cancelled' | 'error'
 */
import auth, { updateDisplay } from '../widget_auth.js';

function makeField() {
    return { model: { set: jest.fn(), set_state: jest.fn(), save_changes: jest.fn() } };
}

function makeThat({ loggedAs = '' } = {}) {
    const state = { auth_state: 'idle', auth_error: '', logged_as: loggedAs };
    return {
        model: {
            get: (name) => {
                if (name === 'params') {
                    return {
                        name: 'google',
                        token_endpoint: 'https://oauth2.googleapis.com/token',
                        url_params: {
                            client_id: 'test-client',
                            redirect_uri: 'http://localhost:8888/callback/',
                            scope: 'openid profile',
                        },
                    };
                }
                return state[name];
            },
            set: (obj) => Object.assign(state, obj),
            save_changes: () => {},
            send: jest.fn(),
        },
        form: {
            btn_main: makeField(),
            logged_as: makeField(),
            time_to_exp: makeField(),
            expires_at: makeField(),
        },
        state,
    };
}

function makePopup() {
    return { close: jest.fn(), closed: false, location: { replace: jest.fn() } };
}

describe('auth_state signal', () => {
    let OriginalBroadcastChannel;

    beforeEach(() => {
        jest.useFakeTimers();
        sessionStorage.clear();
        OriginalBroadcastChannel = globalThis.BroadcastChannel;
        globalThis.BroadcastChannel = class {
            postMessage() {}
            close() {}
        };
    });

    afterEach(() => {
        globalThis.BroadcastChannel = OriginalBroadcastChannel;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it("is 'in_progress' while the sign-in popup is open", async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => makePopup());
        const that = makeThat();
        try {
            expect(await auth.login(that)).toBe(true);
            expect(that.state.auth_state).toBe('in_progress');
        } finally {
            open.mockRestore();
        }
    });

    it("becomes 'cancelled' when the user closes the popup", async () => {
        const popup = makePopup();
        const open = jest.spyOn(window, 'open').mockImplementation(() => popup);
        const that = makeThat();
        try {
            await auth.login(that);
            popup.closed = true;
            jest.advanceTimersByTime(1200); // two poll ticks: the close is confirmed
            expect(that.state.auth_state).toBe('cancelled');
            expect(that.state.auth_error).toBe('cancelled');
        } finally {
            open.mockRestore();
        }
    });

    it('also sends auth state changes as custom messages, which are not throttled', async () => {
        const popup = makePopup();
        const open = jest.spyOn(window, 'open').mockImplementation(() => popup);
        const that = makeThat();
        try {
            await auth.login(that);
            expect(that.model.send).toHaveBeenCalledWith(
                expect.objectContaining({ event: 'auth_state', auth_state: 'in_progress' })
            );
            popup.closed = true;
            jest.advanceTimersByTime(1200);
            expect(that.model.send).toHaveBeenCalledWith({
                event: 'auth_state',
                auth_error: 'cancelled',
                auth_state: 'cancelled',
            });
        } finally {
            open.mockRestore();
        }
    });

    it("stays 'idle' when the automatic attempt on render is blocked", async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const that = makeThat();
        that.state.auth_state = 'cancelled'; // stale outcome of an earlier attempt
        try {
            expect(await auth.attemptAutoLogin(that)).toBe(false);
            expect(that.state.auth_state).toBe('idle');
        } finally {
            open.mockRestore();
        }
    });

    it("becomes 'error' when a user-initiated popup is blocked", async () => {
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const that = makeThat();
        try {
            expect(await auth.login(that)).toBe(false);
            expect(that.state.auth_state).toBe('error');
        } finally {
            open.mockRestore();
        }
    });

    it("becomes 'signed_in' once the tokens are delivered", () => {
        const that = makeThat();
        updateDisplay(that, {
            username: 'user@example.com',
            scope: 'openid profile',
            getStrExpiry: () => 'later',
            getAccessToken: () => 'tok',
            getSecondsToExp: () => -1,
        });
        expect(that.state.auth_state).toBe('signed_in');
        // the tokens are sent before the state changes, so a caller that sees
        // 'signed_in' already has them
        expect(that.model.send).toHaveBeenCalled();
    });

    it("goes back to 'idle' when the session is cleared", () => {
        const that = makeThat({ loggedAs: 'user@example.com' });
        that.state.auth_state = 'signed_in';
        auth.clear(that);
        expect(that.state.auth_state).toBe('idle');
    });
});
