import { startCountdown } from '../widget_auth.js';

function makeField() {
    return {
        model: {
            set: jest.fn(),
            set_state: jest.fn(),
        },
    };
}

function makeThat() {
    return {
        model: {
            set: jest.fn(),
            save_changes: jest.fn(),
            send: jest.fn(),
        },
        form: {
            btn_main: makeField(),
            logged_as: makeField(),
            time_to_exp: makeField(),
            expires_at: makeField(),
        },
    };
}

describe('Expiry renewal behavior', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('clears expired credentials without opening an automatic login popup', () => {
        const that = makeThat();
        that.creds = { access_token: 'old-access', refresh_token: 'old-refresh' };
        const open = jest.spyOn(window, 'open').mockImplementation(() => null);
        const objCreds = { getSecondsToExp: () => 1 };

        try {
            startCountdown(that, objCreds);
            jest.advanceTimersByTime(1000);

            expect(open).not.toHaveBeenCalled();
            expect(that.form.btn_main.model.set_state).toHaveBeenCalledWith({
                description: 'Sign In',
            });
            expect(that.model.set).toHaveBeenCalledWith(
                expect.objectContaining({
                    logged_as: '',
                    expires_at: '',
                })
            );
            expect(that.model.send).toHaveBeenCalledWith({
                event: 'tokens',
                access_token: '',
                refresh_token: '',
            });
            expect(that.creds).toBeNull();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            open.mockRestore();
        }
    });
});
