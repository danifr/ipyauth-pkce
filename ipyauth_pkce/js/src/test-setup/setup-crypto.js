// Jest setup file: expose Node.js globals that jsdom does not provide.
// This runs after the test environment is set up (jsdom), so we can patch its globals.
const { webcrypto } = require('crypto');

// jsdom does not expose TextEncoder / TextDecoder (they are Node.js globals,
// not part of the jsdom DOM implementation). Make them available for tests.
const { TextEncoder, TextDecoder } = require('util');
if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = TextDecoder;
}

// jsdom provides crypto.getRandomValues but not crypto.subtle.
// We need to add subtle to the existing crypto object, or replace it entirely.
if (typeof globalThis.crypto !== 'undefined' && !globalThis.crypto.subtle) {
    // Patch the existing jsdom crypto with subtle from Node's webcrypto
    Object.defineProperty(globalThis.crypto, 'subtle', {
        value: webcrypto.subtle,
        writable: true,
        configurable: true,
    });
} else if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

// jsdom does not provide BroadcastChannel. Provide a minimal mock so that
// production code (buildReadMessage) can instantiate it in tests.
// Individual tests may override globalThis.BroadcastChannel with richer mocks.
if (typeof globalThis.BroadcastChannel === 'undefined') {
    globalThis.BroadcastChannel = class BroadcastChannelMock {
        constructor(name) {
            this.name = name;
            this.onmessage = null;
        }
        postMessage() {}
        close() {
            this.onmessage = null;
        }
    };
}
