/**
 * buildObjCreds().getSecondsToExp() drives the expiry countdown: it must be
 * positive before the expiry and non-positive after it.
 */
import fc from 'fast-check';
import util from '../widget_util.js';

const credsExpiringIn = (seconds) =>
    util.buildObjCreds({ creds: { expiry: new Date(Date.now() + seconds * 1000) } });

describe('getSecondsToExp', () => {
    it('is positive for a future expiry', () => {
        fc.assert(
            fc.property(fc.integer({ min: 2, max: 100000 }), (s) => {
                expect(credsExpiringIn(s).getSecondsToExp()).toBeGreaterThan(0);
            })
        );
    });

    it('is non-positive for a past expiry', () => {
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 100000 }), (s) => {
                expect(credsExpiringIn(-s).getSecondsToExp()).toBeLessThanOrEqual(0);
            })
        );
    });
});
