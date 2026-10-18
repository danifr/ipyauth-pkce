// Callback page orchestration (classic <script>, runs on load).
//
// The decision logic (state validation + error/success discrimination) lives in
// util.js as buildCallbackMessage() so it can be unit-tested directly. This file
// is the thin wire-up: read the URL and the expected state, decide, then display,
// post the result back to the widget, and auto-close.

// extract urlData
const urlData = getDataFromCallbackUrl();

// Validate the exact OAuth state against the value copied into this popup's
// sessionStorage when the popup browsing context was created.
const expectedState = sessionStorage.getItem('ipyauth_expected_state');

// Clean up the stored state regardless of outcome
sessionStorage.removeItem('ipyauth_expected_state');

// Decide the outcome (pure, testable).
const { kind, objMsg } = buildCallbackMessage(urlData, expectedState);

if (kind === 'state_mismatch') {
    // State mismatch — possible CSRF attack
    display('Authentication failed: state mismatch.', 'msg', true);
} else if (kind === 'error') {
    // error in authentication
    display('Authentication failed.', 'msg', true);
    if (urlData.error_description) {
        display(urlData.error_description, 'msg');
    }
} else {
    // A valid callback contains an authorization code.
    display('Authentication completed.', 'msg');
    display('Authorization code received.', 'msg');
}

// post message back to opener window (popup flow)
sendMessageToParent(window, objMsg);

// Auto-close the popup after a short delay.
// In the normal flow, the widget closes the popup via popupWindowRef.close().
// But when the popup was blocked and later allowed by the browser,
// popupWindowRef is null, so the widget can't close it. The popup closes itself.
setTimeout(() => {
    display('Closing...', 'msg');
    window.close();
}, 1500);
