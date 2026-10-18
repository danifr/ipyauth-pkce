/**
 * Feature: manual popup closure cleanup (REMAINING_OPPORTUNITIES #7)
 *
 * After the auth popup navigates to the identity provider, the parent polls
 * `popupWindowRef.closed`. If the user manually closes the popup without
 * completing sign-in, the flow must clean up:
 *   - remove the `message` listener,
 *   - close the BroadcastChannel,
 *   - clear the popup-close poll interval,
 *   - clear `sessionStorage['ipyauth_expected_state']`,
 * so that a subsequent login starts from a clean state.
 *
 * The poll requires the popup to remain closed across a grace tick (with no
 * auth message processed) before declaring an abort, so a legitimate callback
 * whose message is still propagating is never mistaken for a manual close.
 */
import auth from '../widget_auth.js';

function makeThat() {
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
                return undefined;
            },
        },
    };
}

describe('manual popup closure cleanup (#7)', () => {
    let bcInstances;
    let OriginalBroadcastChannel;

    beforeEach(() => {
        jest.useFakeTimers();
        sessionStorage.clear();

        // Track BroadcastChannel instances so we can assert they get closed.
        bcInstances = [];
        OriginalBroadcastChannel = globalThis.BroadcastChannel;
        globalThis.BroadcastChannel = class BroadcastChannelTrack {
            constructor(name) {
                this.name = name;
                this.onmessage = null;
                this.closed = false;
                bcInstances.push(this);
            }
            postMessage() {}
            close() {
                this.closed = true;
                this.onmessage = null;
            }
        };
    });

    afterEach(() => {
        globalThis.BroadcastChannel = OriginalBroadcastChannel;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('cleans up listener, channel, poll, and state when the popup is closed by the user', async () => {
        const popup = {
            close: jest.fn(),
            closed: false,
            location: { replace: jest.fn() },
        };
        const open = jest.spyOn(window, 'open').mockImplementation(() => popup);
        const removeListener = jest.spyOn(window, 'removeEventListener');

        try {
            const opened = await auth.login(makeThat());
            expect(opened).toBe(true);

            // Flow is live: expected-state is stored and a channel exists.
            expect(sessionStorage.getItem('ipyauth_expected_state')).not.toBeNull();
            expect(bcInstances.length).toBe(1);
            expect(bcInstances[0].closed).toBe(false);

            // User manually closes the popup.
            popup.closed = true;

            // Advance across the grace period (two poll ticks) so the watcher
            // confirms the abort.
            jest.advanceTimersByTime(1200);

            // Cleanup must have happened.
            expect(sessionStorage.getItem('ipyauth_expected_state')).toBeNull();
            expect(bcInstances[0].closed).toBe(true);
            expect(removeListener).toHaveBeenCalledWith('message', expect.any(Function));
        } finally {
            removeListener.mockRestore();
            open.mockRestore();
        }
    });

    it('does not clean up while the popup remains open', async () => {
        const popup = {
            close: jest.fn(),
            closed: false,
            location: { replace: jest.fn() },
        };
        const open = jest.spyOn(window, 'open').mockImplementation(() => popup);

        try {
            await auth.login(makeThat());
            expect(sessionStorage.getItem('ipyauth_expected_state')).not.toBeNull();

            // Popup still open: advancing time must not trigger cleanup.
            jest.advanceTimersByTime(5000);

            expect(sessionStorage.getItem('ipyauth_expected_state')).not.toBeNull();
            expect(bcInstances[0].closed).toBe(false);
        } finally {
            open.mockRestore();
        }
    });

    it('does not abort when the auth message arrives as the popup closes (race safety)', async () => {
        // Simulate the real success flow: the popup posts its auth message and
        // then closes. The poll must NOT treat this as a manual-close abort.
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const popup = {
            close: jest.fn(function close() {
                this.closed = true;
            }),
            closed: false,
            location: { replace: jest.fn() },
        };
        const open = jest.spyOn(window, 'open').mockImplementation(() => popup);

        try {
            await auth.login(makeThat());

            const state = sessionStorage.getItem('ipyauth_expected_state');
            expect(state).not.toBeNull();
            expect(bcInstances.length).toBe(1);

            // A valid auth message arrives via the BroadcastChannel (same-origin
            // delivery path). This marks the flow processed and — via
            // processAuthMessage — closes the popup.
            const bc = bcInstances[0];
            expect(typeof bc.onmessage).toBe('function');
            bc.onmessage({
                data: { statusAuth: 'ok', code: 'auth-code-123', state },
            });

            // The popup is now closed (by processAuthMessage). Advancing the
            // timers must NOT trigger the abort warning: the flow was already
            // processed.
            jest.advanceTimersByTime(3000);

            expect(warn).not.toHaveBeenCalledWith(
                'ipyauth: Authentication popup was closed before completing sign-in'
            );
        } finally {
            warn.mockRestore();
            open.mockRestore();
        }
    });

    it('a fresh login after a manual close starts from clean state', async () => {
        const popup1 = { close: jest.fn(), closed: false, location: { replace: jest.fn() } };
        const popup2 = { close: jest.fn(), closed: false, location: { replace: jest.fn() } };
        let call = 0;
        const open = jest.spyOn(window, 'open').mockImplementation(() => {
            call += 1;
            return call === 1 ? popup1 : popup2;
        });

        try {
            await auth.login(makeThat());
            const firstState = sessionStorage.getItem('ipyauth_expected_state');
            expect(firstState).not.toBeNull();

            // User closes the first popup.
            popup1.closed = true;
            jest.advanceTimersByTime(1200);
            expect(sessionStorage.getItem('ipyauth_expected_state')).toBeNull();

            // Second login opens a fresh popup and stores a new state.
            await auth.login(makeThat());
            const secondState = sessionStorage.getItem('ipyauth_expected_state');
            expect(secondState).not.toBeNull();
            expect(bcInstances.length).toBe(2);
        } finally {
            open.mockRestore();
        }
    });
});
