import { updateDisplay } from '../widget_auth.js';

function makeField() {
    return { model: { set: jest.fn(), set_state: jest.fn() } };
}

function makeThat() {
    return {
        model: { set: jest.fn(), save_changes: jest.fn() },
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
            expect.objectContaining({ access_token: 'tok-123', logged_as: 'user@example.com' })
        );
    });
});
