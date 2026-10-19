/**
 * getBaseUrl() must resolve the full per-user service prefix behind JupyterHub.
 *
 * Regression guard: reading only <body data-base-url> resolved to "/" in a
 * JupyterLab federated extension, sending the token-exchange POST to the host
 * root (/callback/token-exchange) where the hub returns 403 instead of the
 * single-user server handling it at /user/<name>/<server>/callback/token-exchange.
 */
import { getBaseUrl } from '../widget_auth.js';

describe('getBaseUrl', () => {
    const origPathname = window.location.pathname;

    afterEach(() => {
        // Clean up any injected config/body state between tests.
        const el = document.getElementById('jupyter-config-data');
        if (el) {
            el.remove();
        }
        document.body.removeAttribute('data-base-url');
        window.history.replaceState({}, '', origPathname);
    });

    function setConfigData(obj) {
        const el = document.createElement('script');
        el.id = 'jupyter-config-data';
        el.type = 'application/json';
        el.textContent = JSON.stringify(obj);
        document.body.appendChild(el);
    }

    it('prefers baseUrl from #jupyter-config-data (JupyterHub prefix)', () => {
        setConfigData({ baseUrl: '/user/danifr/abc123/' });
        document.body.setAttribute('data-base-url', '/'); // should be ignored
        expect(getBaseUrl()).toBe('/user/danifr/abc123/');
    });

    it('falls back to body[data-base-url] when config data is absent', () => {
        document.body.setAttribute('data-base-url', '/user/danifr/abc123/');
        expect(getBaseUrl()).toBe('/user/danifr/abc123/');
    });

    it('ignores malformed config data and falls back', () => {
        const el = document.createElement('script');
        el.id = 'jupyter-config-data';
        el.type = 'application/json';
        el.textContent = '{ not valid json';
        document.body.appendChild(el);
        document.body.setAttribute('data-base-url', '/user/danifr/abc123/');
        expect(getBaseUrl()).toBe('/user/danifr/abc123/');
    });

    it('derives the /user/<name>/<server>/ prefix from the URL when nothing else is set', () => {
        window.history.replaceState({}, '', '/user/danifr/19948fcb4b66cf8/lab/tree/notebook.ipynb');
        expect(getBaseUrl()).toBe('/user/danifr/19948fcb4b66cf8/');
    });

    it('returns "/" when no prefix can be determined', () => {
        window.history.replaceState({}, '', '/lab');
        expect(getBaseUrl()).toBe('/');
    });
});
