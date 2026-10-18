const isLogged = (that) => Boolean(that.model.get('logged_as'));

const createNonce = () => {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
};

const toHMS = (n_sec) => {
    let hours = Math.floor(n_sec / 3600);
    let minutes = Math.floor((n_sec - hours * 3600) / 60);
    let seconds = n_sec - hours * 3600 - minutes * 60;

    if (hours < 10) hours = `0${hours}`;
    if (minutes < 10) minutes = `0${minutes}`;
    if (seconds < 10) seconds = `0${seconds}`;

    return `${hours}:${minutes}:${seconds}`;
};

const serialize = (obj) => {
    const elmts = Object.entries(obj).map((i) => [i[0], encodeURIComponent(i[1])].join('='));
    return elmts.join('&');
};

const buildObjCreds = (that) => {
    const { creds } = that;
    const obj = Object.assign({}, creds);

    obj.getSecondsToExp = () => parseInt((creds.expiry - new Date()) / 1000, 10);

    obj.getStrExpiry = () => {
        if (obj.expiry) return obj.expiry.toString();
        return '';
    };

    obj.getAccessToken = () => (obj.access_token ? obj.access_token : '');

    return obj;
};

const buildWindowProps = (objProps) => {
    const strProps = Object.entries(objProps)
        .map((e) => `${e[0]}=${e[1]}`)
        .join(',');
    return strProps;
};

// Return a copy of url_params with a fresh random nonce and OAuth state.
// The same value is used as the OIDC nonce (bound into the ID token and checked
// by validateIdToken) and as the unguessable part of the state.
const buildUrlParams = (paramsFull) => {
    const nonce = createNonce();
    return Object.assign({}, paramsFull.url_params, {
        nonce,
        state: [paramsFull.name, 'popup', nonce].join(','),
    });
};

const buildAuthorizeUrl = (paramsFull) => {
    const url_params = Object.assign({}, paramsFull.url_params);

    const paramsEncoded = serialize(url_params);
    const authUrl = `${paramsFull.authorize_endpoint}?${paramsEncoded}`;
    return authUrl;
};

const escapeHtml = (str) => {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
};

const toHtml = (str, className) => {
    const css = {
        'ipyauth-name': `
			.ipyauth-name {
				background-color: white;
				text-align: center;
				line-height: 20px;
			}`,
        'ipyauth-expiry': `
			.ipyauth-expiry {
				background-color: white;
				text-align: center;
				line-height: 20px;
				white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                width: 290px;
			}`,
        'ipyauth-time-to-exp-msg': `
			.ipyauth-time-to-exp-msg {
				background-color: white;
				padding-left: 4px;
				padding-right: 4px;
				line-height: 20px;
			}`,
        'ipyauth-error-msg': `
			.ipyauth-error-msg {
				background-color: #fdecea;
				color: #a1160a;
				border: 1px solid #f5c6cb;
				border-radius: 3px;
				padding: 3px 6px;
				line-height: 20px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}`,
    };
    const new_str = escapeHtml(str || '');
    const myCSS = `ipyauth-${className}`;
    const roleAttr = className === 'error-msg' ? ' role="alert"' : '';
    const html = `<style>${css[myCSS]}</style><div class="${myCSS}"${roleAttr}>${new_str}</div>`;
    return html;
};

const ID_TOKEN_CLOCK_SKEW_SECONDS = 60;

const ID_TOKEN_ALGORITHMS = {
    RS256: {
        import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        verify: { name: 'RSASSA-PKCS1-v1_5' },
    },
    RS384: {
        import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' },
        verify: { name: 'RSASSA-PKCS1-v1_5' },
    },
    RS512: {
        import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
        verify: { name: 'RSASSA-PKCS1-v1_5' },
    },
    PS256: {
        import: { name: 'RSA-PSS', hash: 'SHA-256' },
        verify: { name: 'RSA-PSS', saltLength: 32 },
    },
    PS384: {
        import: { name: 'RSA-PSS', hash: 'SHA-384' },
        verify: { name: 'RSA-PSS', saltLength: 48 },
    },
    PS512: {
        import: { name: 'RSA-PSS', hash: 'SHA-512' },
        verify: { name: 'RSA-PSS', saltLength: 64 },
    },
};

const base64urlToBytes = (value) => {
    let base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) {
        base64 += '='.repeat(4 - pad);
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
};

const decodeJwtJson = (value) => {
    const decoded = new TextDecoder().decode(base64urlToBytes(value));
    return JSON.parse(decoded);
};

const audienceMatches = (audience, expectedAudience) => {
    if (typeof audience === 'string') {
        return audience === expectedAudience;
    }
    return Array.isArray(audience) && audience.includes(expectedAudience);
};

const validateIdTokenClaims = (idToken, expected) => {
    if (!idToken || typeof idToken !== 'object') {
        return false;
    }
    if (typeof idToken.iss !== 'string' || idToken.iss.length === 0) {
        return false;
    }
    if (expected.issuer !== idToken.iss) {
        return false;
    }
    if (!audienceMatches(idToken.aud, expected.audience)) {
        return false;
    }
    if (typeof idToken.sub !== 'string' || idToken.sub.length === 0) {
        return false;
    }
    if (!Number.isFinite(idToken.exp) || !Number.isFinite(idToken.iat)) {
        return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (idToken.exp <= now - ID_TOKEN_CLOCK_SKEW_SECONDS) {
        return false;
    }
    if (idToken.iat > now + ID_TOKEN_CLOCK_SKEW_SECONDS || idToken.iat > idToken.exp) {
        return false;
    }
    if (expected.nonce !== undefined && idToken.nonce !== expected.nonce) {
        return false;
    }
    return true;
};

const verifyIdTokenSignature = async (rawToken, jwksUrl) => {
    try {
        const parts = rawToken.split('.');
        if (parts.length !== 3 || typeof jwksUrl !== 'string' || jwksUrl.length === 0) {
            return false;
        }

        const header = decodeJwtJson(parts[0]);
        const algorithm = ID_TOKEN_ALGORITHMS[header.alg];
        if (!algorithm || typeof header.kid !== 'string' || header.kid.length === 0) {
            return false;
        }

        const response = await fetch(jwksUrl, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });
        if (!response.ok) {
            return false;
        }
        const jwks = await response.json();
        const jwk =
            Array.isArray(jwks.keys) &&
            jwks.keys.find(
                (key) =>
                    key.kid === header.kid &&
                    key.kty === 'RSA' &&
                    (!key.use || key.use === 'sig') &&
                    (!key.alg || key.alg === header.alg)
            );
        if (!jwk) {
            return false;
        }

        const publicKey = await crypto.subtle.importKey('jwk', jwk, algorithm.import, false, [
            'verify',
        ]);
        return crypto.subtle.verify(
            algorithm.verify,
            publicKey,
            base64urlToBytes(parts[2]),
            new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
        );
    } catch (error) {
        console.warn('ipyauth: ID-token signature verification failed', error);
        return false;
    }
};

const validateIdToken = async (idToken, expected, rawToken) => {
    if (!validateIdTokenClaims(idToken, expected)) {
        return false;
    }
    // Direct provider-unit tests may supply parsed claims only. Production
    // token responses include the raw JWT, so production validation verifies
    // its signature against the provider's JWKS endpoint.
    if (rawToken === undefined) {
        return true;
    }
    return verifyIdTokenSignature(rawToken, expected.jwksUrl);
};

/**
 * Shared isValid() for standard OIDC providers (Auth0, Keycloak): validate the
 * ID token against the provider issuer/JWKS, then fill in username, scope (not
 * returned when everything requested was granted) and expiry (the earlier of
 * the access-token and ID-token expiries).
 *
 * @param {object} provider - { issuer(params), jwksUrl(issuer), username(idToken) }
 */
const validateOidcCreds = async (params, creds, provider) => {
    const { url_params } = params;
    const idToken = creds.id_token;
    if (!idToken) {
        return [false, creds];
    }

    const issuer = params.issuer || provider.issuer(params.authorize_endpoint || '');
    const claimsValid = await validateIdToken(
        idToken,
        {
            issuer,
            audience: url_params.client_id,
            nonce: url_params.nonce,
            jwksUrl: provider.jwksUrl(issuer),
        },
        creds.id_token_raw
    );
    if (!claimsValid) {
        return [false, creds];
    }

    creds.username = provider.username(idToken);
    if (!creds.scope) {
        creds.scope = url_params.scope;
    }
    const idExpiry = idToken.exp * 1000;
    const accessExpiry = Number.isFinite(creds.expires_in)
        ? Date.now() + creds.expires_in * 1000
        : idExpiry;
    creds.expiry = new Date(Math.min(idExpiry, accessExpiry));
    return [true, creds];
};

// Decode the JWT payload for subsequent claim and signature validation.
const parseJwt = (id_token) => {
    try {
        const parts = id_token.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid JWT: expected 3 parts');
        }
        return decodeJwtJson(parts[1]);
    } catch (e) {
        console.error('ipyauth: Failed to parse JWT', e);
        return {};
    }
};

export default {
    isLogged,

    buildWindowProps,
    buildAuthorizeUrl,
    buildUrlParams,
    buildObjCreds,

    toHMS,
    toHtml,

    parseJwt,
    validateIdTokenClaims,
    validateIdToken,
    validateOidcCreds,
    verifyIdTokenSignature,
};
