import util from './widget_util';
import provider from './providers/index';
import { focusNextCell } from './app_commands';

/**
 * Base64url-encode a Uint8Array buffer (no padding).
 * Converts standard base64 characters (+, /, =) to URL-safe equivalents (-, _, stripped).
 */
export function base64urlEncode(buffer) {
    return btoa(String.fromCharCode(...buffer))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

/**
 * Generate a cryptographically random PKCE code_verifier (RFC 7636).
 * Uses 32 random bytes → base64url-encoded → 43 characters.
 */
export function generateCodeVerifier() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return base64urlEncode(array);
}

/**
 * Compute the PKCE code_challenge: SHA-256 hash of the verifier, base64url-encoded.
 */
export async function generateCodeChallenge(verifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return base64urlEncode(new Uint8Array(digest));
}

const getBroadcastChannelName = (state) => {
    if (typeof state !== 'string' || state.length === 0) {
        return null;
    }
    return `ipyauth-${encodeURIComponent(state)}`;
};

const ipyauthStatus = {
    popupWindowRef: null,
    currentReadMessage: null,
    currentBroadcastChannel: null,
    popupClosePoll: null,
};

const stopPopupClosePoll = () => {
    if (ipyauthStatus.popupClosePoll !== null) {
        clearInterval(ipyauthStatus.popupClosePoll);
        ipyauthStatus.popupClosePoll = null;
    }
};

/**
 * Tear down all per-flow browser resources: the postMessage listener, the
 * BroadcastChannel, the popup-closed poll, and the expected-state entry in
 * sessionStorage. Safe to call multiple times.
 */
const cleanupAuthFlow = () => {
    if (ipyauthStatus.currentReadMessage) {
        window.removeEventListener('message', ipyauthStatus.currentReadMessage);
        ipyauthStatus.currentReadMessage = null;
    }
    if (ipyauthStatus.currentBroadcastChannel) {
        ipyauthStatus.currentBroadcastChannel.close();
        ipyauthStatus.currentBroadcastChannel = null;
    }
    stopPopupClosePoll();
    sessionStorage.removeItem('ipyauth_expected_state');
};

// How often (ms) to check whether the user manually closed the auth popup.
const POPUP_CLOSE_POLL_INTERVAL_MS = 500;

/**
 * Show a short, user-facing error message in the widget's error field.
 *
 * Messages must be safe to display verbatim: never pass raw provider
 * `error_description`, tokens, authorization codes, or other sensitive values
 * here — only fixed, categorized strings chosen by this module. The value is
 * HTML-escaped by `util.toHtml`, and the field is rendered with role="alert"
 * for assistive technologies.
 */
const showError = (that, message) => {
    const field = that && that.form && that.form.error;
    if (!field) {
        return;
    }
    field.model.set({ value: util.toHtml(message, 'error-msg') });
    field.model.save_changes();
    // Un-hide the field. It is display:none by default on the Python side,
    // applied through the ipywidgets layout model — so toggle the layout model
    // (the mechanism the framework re-applies on updates), and also set the DOM
    // style directly as a belt-and-braces fallback for environments/tests
    // without a layout sub-model.
    setFieldDisplay(field, '');
};

/**
 * Clear and hide the widget's error field. Called at the start of a new login
 * attempt and on clear(), so a stale error never lingers past a fresh flow.
 */
const clearError = (that) => {
    const field = that && that.form && that.form.error;
    if (!field) {
        return;
    }
    field.model.set({ value: '' });
    field.model.save_changes();
    setFieldDisplay(field, 'none');
};

/**
 * Set a widget field's CSS display via its ipywidgets layout model when
 * available, falling back to the DOM element's inline style.
 */
const setFieldDisplay = (field, value) => {
    const layout = field.model && field.model.get && field.model.get('layout');
    if (layout && typeof layout.set === 'function') {
        layout.set('display', value);
        if (typeof layout.save_changes === 'function') {
            layout.save_changes();
        }
    }
    if (field.el && field.el.style) {
        field.el.style.display = value;
    }
};

/**
 * Open a blank popup while the button's user activation is still active.
 *
 * The authorization URL is populated later, after the asynchronous PKCE
 * challenge has been computed. Opening the blank window first avoids popup
 * blockers treating the eventual navigation as a non-user-initiated action.
 *
 * @param {string} name - Window name for the popup
 * @param {Object|null} windowProps - Optional window properties
 * @returns {Window|null} Reference to the popup window, or null if blocked
 */
const openAuthPopup = (name, windowProps = null) => {
    let props = windowProps;
    if (!props) {
        // Center the popup on screen
        const width = 660;
        const height = 790;
        const left = Math.max(0, Math.round((screen.width - width) / 2));
        const top = Math.max(0, Math.round((screen.height - height) / 2));
        props = {
            menubar: 'yes',
            location: 'no',
            resizable: 'yes',
            scrollbars: 'yes',
            status: 'yes',
            width: String(width),
            height: String(height),
            left: String(left),
            top: String(top),
        };
    }
    props = util.buildWindowProps(props);
    return window.open('about:blank', name, props);
};

async function startAuthFlow(that, isUserInitiated = true) {
    // Clean up any previous auth flow listener, channel, poll, and stale state.
    cleanupAuthFlow();
    // A new attempt starts clean: drop any error shown from a previous flow.
    clearError(that);

    // init
    const paramsModel = that.model.get('params');
    const IdProviderName = paramsModel.name;

    // Build the state synchronously so the blank popup inherits it through
    // sessionStorage when the popup browsing context is created.
    const codeVerifier = generateCodeVerifier();
    const paramsTemplate = provider[IdProviderName];
    // Provider template supplies fixed values; the Python params override them.
    const paramsFull = {
        ...paramsTemplate,
        ...paramsModel,
        url_params: {
            ...paramsTemplate.url_params,
            ...paramsModel.url_params,
            response_type: 'code',
        },
    };
    paramsFull.url_params = util.buildUrlParams(paramsFull);
    sessionStorage.setItem('ipyauth_expected_state', paramsFull.url_params.state);

    // Open synchronously while the button's user activation is still active.
    const ref = openAuthPopup(IdProviderName);
    if (!ref) {
        sessionStorage.removeItem('ipyauth_expected_state');
        console.warn(
            'ipyauth: Popup was blocked by the browser. Please allow popups for this site.'
        );
        ipyauthStatus.popupWindowRef = null;
        // Only surface this to the user for an explicit "Sign In" click. On the
        // automatic attempt at render there is no user gesture, so a blocked
        // popup is the normal, expected outcome and must not show an error.
        if (isUserInitiated) {
            showError(that, 'Popup blocked. Please allow popups for this site and try again.');
        }
        // Signal to callers (e.g. the auto-login attempt on render) that the
        // popup did not open so they can fall back to the manual button.
        return false;
    }
    ipyauthStatus.popupWindowRef = ref;

    try {
        // Complete the PKCE pair after the popup has been opened.
        const codeChallenge = await generateCodeChallenge(codeVerifier);

        // Set authorization code flow with PKCE params
        paramsFull.url_params.code_challenge = codeChallenge;
        paramsFull.url_params.code_challenge_method = 'S256';

        // build authorize url
        const authUrl = util.buildAuthorizeUrl(paramsFull);

        // build readmessage function — capture codeVerifier in closure
        that.params = paramsFull;
        const readMessage = buildReadMessage(that, codeVerifier);

        // Track and register the listener before navigating the popup.
        ipyauthStatus.currentReadMessage = readMessage;
        window.addEventListener('message', readMessage);

        if (ref.closed) {
            throw new Error('Authentication popup was closed before navigation');
        }
        ref.location.replace(authUrl);

        // Begin watching for the user manually closing the popup (aborted flow).
        readMessage.startPopupClosePoll();
    } catch (err) {
        cleanupAuthFlow();
        if (!ref.closed) {
            ref.close();
        }
        ipyauthStatus.popupWindowRef = null;
        console.error('ipyauth: Failed to start authentication flow', err);
        showError(that, 'Could not start sign-in. Please try again.');
        return false;
    }

    return true;
}

/**
 * Read the _xsrf cookie value for Jupyter Server XSRF protection.
 */
function getXsrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)_xsrf=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
}

/**
 * Get the Jupyter base URL from the page's <body data-base-url="..."> attribute.
 */
function getBaseUrl() {
    const body = document.querySelector('body');
    return (body && body.getAttribute('data-base-url')) || '/';
}

/**
 * Exchange an authorization code for tokens via the server-side token exchange endpoint.
 * Posts {code, code_verifier, redirect_uri, token_endpoint, client_id} to
 * /callback/token-exchange and returns the parsed token response.
 */
async function exchangeCodeForTokens(params, data, codeVerifier) {
    const { url_params } = params;
    const body = {
        code: data.code,
        code_verifier: codeVerifier,
        redirect_uri: url_params.redirect_uri,
        token_endpoint: params.token_endpoint || '',
        client_id: url_params.client_id,
    };

    const baseUrl = getBaseUrl().replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/callback/token-exchange`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-XSRFToken': getXsrfToken(),
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
            errorData.error_description ||
                errorData.error ||
                `Token exchange failed (${response.status})`
        );
    }

    return response.json();
}

const buildReadMessage = (that, codeVerifier) => {
    const { params } = that;
    // Store expected callback origin and exact state for message validation
    const expectedOrigin = window.location.origin;
    const expectedState = params.url_params && params.url_params.state;

    const isValidAuthMessage = (data) => {
        if (!data || typeof data !== 'object' || typeof data.statusAuth !== 'string') {
            return false;
        }
        if (typeof expectedState !== 'string' || data.state !== expectedState) {
            console.warn('ipyauth: Ignored callback with unexpected OAuth state');
            return false;
        }
        if (data.statusAuth !== 'ok' && data.statusAuth !== 'error') {
            return false;
        }
        if (data.statusAuth === 'ok' && (typeof data.code !== 'string' || data.code.length === 0)) {
            console.warn('ipyauth: Rejected callback without an authorization code');
            return false;
        }
        return true;
    };

    // First-message-wins flag: prevents double processing when both
    // postMessage and BroadcastChannel deliver the same auth message.
    let processed = false;

    // Tear down this flow's listener, BroadcastChannel, popup-close poll and
    // expected state. Declared before the handlers/poll so they can all share
    // it. The BroadcastChannel reference (bc) is assigned below and captured lazily.
    const finishFlow = () => {
        window.removeEventListener('message', readMessage);
        if (bc) bc.close();
        stopPopupClosePoll();
        ipyauthStatus.currentReadMessage = null;
        ipyauthStatus.currentBroadcastChannel = null;
        sessionStorage.removeItem('ipyauth_expected_state');
    };

    // Poll for the user manually closing the popup after it has navigated to
    // the identity provider. If the popup closes before any auth message is
    // processed, treat it as an aborted flow: remove the message listener,
    // close the BroadcastChannel, clear the poll, and clear the expected OAuth
    // state so a subsequent login starts clean. See REMAINING_OPPORTUNITIES #7.
    const startPopupClosePoll = () => {
        stopPopupClosePoll();
        const ref = ipyauthStatus.popupWindowRef;
        if (!ref) {
            return;
        }
        // Number of consecutive "closed" observations required before treating
        // the flow as aborted. The popup posts its auth message immediately but
        // self-closes shortly after; requiring two ticks gives any in-flight
        // postMessage/BroadcastChannel delivery time to set `processed` first,
        // so a successful login is never mistaken for an abort.
        let closedTicks = 0;
        ipyauthStatus.popupClosePoll = setInterval(() => {
            // Stop polling once a message has been processed; the message
            // handlers own cleanup in that case.
            if (processed) {
                stopPopupClosePoll();
                return;
            }
            let isClosed = false;
            try {
                isClosed = ref.closed;
            } catch (err) {
                // Cross-origin access to .closed should not throw, but guard
                // defensively: if we cannot read it, stop polling.
                isClosed = true;
            }
            if (!isClosed) {
                closedTicks = 0;
                return;
            }
            closedTicks += 1;
            // Require the popup to stay closed across a grace tick with no
            // message processed before declaring the flow aborted. This avoids
            // racing a legitimate callback whose message is still propagating.
            if (closedTicks < 2) {
                return;
            }
            processed = true;
            finishFlow();
            ipyauthStatus.popupWindowRef = null;
            console.warn('ipyauth: Authentication popup was closed before completing sign-in');
            showError(that, 'Sign-in was cancelled (popup closed).');
        }, POPUP_CLOSE_POLL_INTERVAL_MS);
    };

    // Helper that contains the shared auth message processing logic.
    // Both the postMessage listener and BroadcastChannel handler call this.
    const processAuthMessage = (data) => {
        if (ipyauthStatus.popupWindowRef) {
            ipyauthStatus.popupWindowRef.close();
        }

        if (data.statusAuth === 'ok') {
            // Authorization Code flow: exchange code for tokens server-side
            exchangeCodeForTokens(params, data, codeVerifier)
                .then((tokenData) => {
                    // Merge token response with original callback data (preserves state, etc.)
                    const mergedData = Object.assign({}, data, tokenData);
                    // Parse id_token JWT if present
                    if (mergedData.id_token && typeof mergedData.id_token === 'string') {
                        const rawIdToken = mergedData.id_token;
                        Object.defineProperty(mergedData, 'id_token_raw', {
                            value: rawIdToken,
                            enumerable: false,
                        });
                        mergedData.id_token = util.parseJwt(rawIdToken);
                    }
                    return params.isValid(params, mergedData);
                })
                .then(([isValid, creds]) => {
                    if (isValid) {
                        that.creds = creds;
                        const objCreds = util.buildObjCreds(that);
                        updateDisplay(that, objCreds);
                    } else {
                        console.error('ipyauth Error: Token validation failed');
                        showError(that, 'Sign-in failed: token validation error.');
                    }
                })
                .catch((err) => {
                    console.error('ipyauth Error: Token exchange failed', err);
                    // The server emits a specific, safe hint when the operator
                    // has not configured the token endpoint — surface a friendly
                    // version of that so the user knows it is a setup issue, not
                    // their fault. Never echo raw error_description otherwise.
                    const msg =
                        err &&
                        typeof err.message === 'string' &&
                        err.message.indexOf('IPYAUTH_TOKEN_ENDPOINT') !== -1
                            ? 'Sign-in is not configured on the server (token endpoint missing). Contact the server administrator.'
                            : 'Sign-in failed: could not exchange the authorization code.';
                    showError(that, msg);
                });
        }

        if (data.statusAuth === 'error') {
            console.error('ipyauth Error: Authentication failed');
            showError(that, 'Sign-in failed. Please try again.');
        }
    };

    // Create a per-flow BroadcastChannel listener alongside postMessage.
    // BroadcastChannel is same-origin only, so no origin check is needed.
    const channelName = getBroadcastChannelName(expectedState);
    const bc = channelName ? new BroadcastChannel(channelName) : null;

    if (bc) {
        bc.onmessage = (event) => {
            if (processed) return;

            const { data } = event;

            // Validate the complete callback message before processing
            if (!isValidAuthMessage(data)) {
                // parasite or mismatched-flow message — ignore and allow future messages
                return;
            }

            processed = true;

            // Clean up listener, channel, and popup-close poll.
            finishFlow();

            processAuthMessage(data);
        };
    }

    // Store BroadcastChannel reference for cleanup on re-entry
    ipyauthStatus.currentBroadcastChannel = bc;

    const readMessage = (event) => {
        // Validate event.origin matches expected callback origin
        if (event.origin !== expectedOrigin) {
            return;
        }
        if (
            event.source &&
            ipyauthStatus.popupWindowRef &&
            event.source !== ipyauthStatus.popupWindowRef
        ) {
            return;
        }

        // extract data from message
        const { data } = event;

        // Validate the complete callback message before processing
        if (!isValidAuthMessage(data)) {
            // sso window may send parasite or mismatched-flow messages
            return;
        }

        if (processed) return;
        processed = true;

        // deactivate msg reception — clean up listener, channel, and poll.
        finishFlow();

        processAuthMessage(data);
    };

    // Expose the poll starter on the listener so startAuthFlow can begin
    // watching for manual popup closure after navigation, without changing
    // buildReadMessage's return contract (it still returns a callable listener).
    readMessage.startPopupClosePoll = startPopupClosePoll;

    return readMessage;
};

const login = async (that) => startAuthFlow(that, true);

/**
 * Attempt to launch the auth flow automatically (e.g. right after the widget
 * renders on cell execution), without a user click.
 *
 * Browsers only allow window.open() during an active user gesture, so an
 * automatic attempt will usually be blocked unless the user has whitelisted
 * popups for this origin. This function therefore treats a blocked popup as a
 * normal, expected outcome: the manual "Sign In" button remains available as
 * the fallback.
 *
 * Skips the attempt entirely when the user is already logged in.
 *
 * @returns {Promise<boolean>} true if the popup opened, false if it was
 *   blocked, skipped, or otherwise did not open.
 */
const attemptAutoLogin = async (that) => {
    if (util.isLogged(that)) {
        return false;
    }
    return startAuthFlow(that, false);
};

const updateDisplay = (that, objCreds) => {
    that.model.set({
        logged_as: objCreds.username,
        expires_at: objCreds.getStrExpiry(),
        scope: objCreds.scope || '',
        access_token: objCreds.getAccessToken(),
    });

    that.form.btn_main.model.set_state({ description: 'Clear' });
    that.form.logged_as.model.set({
        value: util.toHtml('Logged as: ' + objCreds.username, 'name'),
    });
    that.form.expires_at.model.set({ value: util.toHtml(objCreds.getStrExpiry(), 'expiry') });

    // save state
    that.model.save_changes();

    // countdown to expiry
    startCountdown(that, objCreds);

    // Move the notebook selection off the auth cell so the user does not
    // accidentally re-run the sign-in cell. No-op outside JupyterLab or if the
    // command registry / command is unavailable.
    focusNextCell(that);
};

const startCountdown = (that, objCreds) => {
    let nbSec = objCreds.getSecondsToExp();
    if (nbSec > -1) {
        if (that.timer) {
            clearInterval(that.timer);
        }
        that.timer = setInterval(() => {
            nbSec -= 1;
            if (nbSec >= 0) {
                const time_to_exp = util.toHMS(nbSec);
                that.model.set({ time_to_exp });
                that.form.time_to_exp.model.set({
                    value: util.toHtml(time_to_exp, 'time-to-exp-msg'),
                });
                // save state
                that.model.save_changes();
            }
            if (nbSec === 0) {
                clear(that);
            }
        }, 1000);
    }
};

const clear = (that) => {
    clearInterval(that.timer);

    that.model.set({
        access_token: '',
        logged_as: '',
        time_to_exp: '',
        expires_at: '',
        scope: '',
    });
    that.form.btn_main.model.set_state({ description: 'Sign In' });
    that.form.logged_as.model.set({ value: '' });
    that.form.time_to_exp.model.set({ value: '' });
    that.form.expires_at.model.set({ value: '' });
    clearError(that);

    // save state
    that.model.save_changes();
};

const { isLogged } = util;

export default {
    login,
    attemptAutoLogin,
    clear,
    isLogged,
};

export { buildReadMessage, startCountdown };
