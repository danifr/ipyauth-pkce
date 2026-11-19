import { updateDisplay } from '../widget_auth.js';

function makeField() {
    return { model: { set: jest.fn(), set_state: jest.fn() } };
}

function makeThat() {
    return {
        model: { set: jest.fn(), save_changes: jest.fn(), send: jest.fn() },
        form: {
            btn_main: makeField(),
            logged_as: makeField(),
            time_to_exp: makeField(),
            expires_at: makeField(),
        },
    };
}

function makeObjCreds() {
    return {
        username: 'user@example.com',
        scope: 'openid profile',
        getStrExpiry: () => 'Sat Nov 07 2026 16:00:00',
        getAccessToken: () => 'tok-123',
        refresh_token: 'refresh-456',
        expiry: new Date(1800000000000),
        getSecondsToExp: () => -1,
    };
}

describe('logged-in button relabels to Refresh', () => {
    it('sets the main button description to "Refresh" after a successful login', () => {
        const that = makeThat();
        updateDisplay(that, makeObjCreds());

        expect(that.form.btn_main.model.set_state).toHaveBeenCalledWith({
            description: 'Refresh',
        });
        expect(that.model.set).toHaveBeenCalledWith(
            expect.objectContaining({ logged_as: 'user@example.com' })
        );
    });

    it('sends tokens as a custom message and keeps them out of the model state', () => {
        const that = makeThat();
        updateDisplay(that, makeObjCreds());

        expect(that.model.send).toHaveBeenCalledWith({
            event: 'tokens',
            access_token: 'tok-123',
            refresh_token: 'refresh-456',
            expires_at_ms: 1800000000000,
        });
        for (const [attrs] of that.model.set.mock.calls) {
            expect(attrs).not.toHaveProperty('access_token');
            expect(attrs).not.toHaveProperty('refresh_token');
        }
    });

    it('sends an empty refresh token when the provider returned none', () => {
        const that = makeThat();
        const objCreds = makeObjCreds();
        delete objCreds.refresh_token;
        updateDisplay(that, objCreds);

        expect(that.model.send).toHaveBeenCalledWith(
            expect.objectContaining({ access_token: 'tok-123', refresh_token: '' })
        );
    });

    it('sends a null expiry when the credentials have none', () => {
        const that = makeThat();
        const objCreds = makeObjCreds();
        delete objCreds.expiry;
        updateDisplay(that, objCreds);

        expect(that.model.send).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'tokens', expires_at_ms: null })
        );
    });
});
