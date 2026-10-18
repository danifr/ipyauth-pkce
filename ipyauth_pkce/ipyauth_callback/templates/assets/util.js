function display(obj, id = 'authStatus', reset = false) {
    const e = document.getElementById(id);
    const line = document.createElement('span');
    line.textContent = String(obj);
    if (reset) {
        e.textContent = '';
    }
    e.appendChild(line);
    e.appendChild(document.createElement('br'));
    e.appendChild(document.createElement('br'));
}

///////////////////////////////////////////////////////

function getDataFromCallbackUrl(href) {
    const source = typeof href === 'string' ? href : window.location.href;
    const url1 = source.split('#')[1];
    const url2 = source.split('?')[1];
    const url = url1 ? url1 : url2;
    if (!url) {
        return {};
    }
    const urlParams = new URLSearchParams(url);
    const entries = Array.from(urlParams.entries());
    // Validate parameters: reject values exceeding 4096 chars or containing control characters
    const validEntries = entries.filter(([k, v]) => 
        v.length <= 4096 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)
    );
    if (validEntries.length === 0) {
        return {};
    }
    const data = Object.assign(
        ...validEntries.map(([k, v]) => ({ [k]: v }))
    );
    return data;
}

function containsError(urlData) {
    if ('error' in urlData || 'error_description' in urlData) return true;
    if ('access_token' in urlData || 'id_token' in urlData) return true;
    if (!('code' in urlData) || !urlData.code) return true;
    if (!('state' in urlData)) return true;
    return false;
}

function getBroadcastChannelName(state) {
    if (typeof state !== 'string' || state.length === 0) {
        return null;
    }
    return `ipyauth-${encodeURIComponent(state)}`;
}

function sendMessageToParent(window, objMsg) {
    // Derive targetOrigin from opener's origin or fall back to callback page origin
    let targetOrigin;
    try {
        targetOrigin = window.opener && window.opener.origin ? window.opener.origin : window.location.origin;
    } catch (e) {
        // Cross-origin access to opener.origin may throw; fall back to callback page origin
        targetOrigin = window.location.origin;
    }

    if (window.opener) {
        window.opener.postMessage(objMsg, targetOrigin);
    }

    // BroadcastChannel fallback — use a per-flow channel when the opener
    // relationship is unavailable (for example, after a COOP boundary).
    const channelName = getBroadcastChannelName(objMsg && objMsg.state);
    if (channelName) {
        const bc = new BroadcastChannel(channelName);
        bc.postMessage(objMsg);
        bc.close();
    }
}

// Build an error message carrying only the non-sensitive OAuth error fields.
function buildErrorMessage(data) {
    const message = { statusAuth: 'error' };
    for (const key of ['state', 'error', 'error_description', 'error_uri']) {
        if (data && typeof data[key] === 'string') {
            message[key] = data[key];
        }
    }
    return message;
}

// Pure decision logic for the callback page: given the parsed callback URL data
// and the OAuth state expected by this flow, decide what postMessage payload to
// send back to the widget. This is the security-relevant heart of the callback
// (state validation + error/success discrimination) and is extracted here so it
// can be unit-tested directly instead of being reimplemented in tests.
//
// Returns { kind, objMsg } where kind is one of:
//   'state_mismatch' — expected/actual state did not match (possible CSRF)
//   'error'          — provider returned an OAuth error (or a rejected response)
//   'ok'             — a valid authorization code was received
function buildCallbackMessage(urlData, expectedState) {
    const data = urlData || {};

    const stateValid =
        typeof expectedState === 'string' &&
        typeof data.state === 'string' &&
        data.state === expectedState;

    if (!stateValid) {
        return {
            kind: 'state_mismatch',
            objMsg: buildErrorMessage({ state: data.state, error: 'state_mismatch' }),
        };
    }

    if (containsError(data)) {
        return { kind: 'error', objMsg: buildErrorMessage(data) };
    }

    return {
        kind: 'ok',
        objMsg: { statusAuth: 'ok', code: data.code, state: data.state },
    };
}

// Dual-mode export: in the browser these functions are plain globals defined by
// this classic <script>; under a CommonJS test runner (Jest) they are also
// importable so tests exercise the real callback code rather than a copy.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        display,
        getDataFromCallbackUrl,
        containsError,
        getBroadcastChannelName,
        sendMessageToParent,
        buildErrorMessage,
        buildCallbackMessage,
    };
}
