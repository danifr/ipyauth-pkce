import util from '../widget_util';

const auth0 = {
    name: 'auth0',
    url_params: {},
    isValid: (params, creds) =>
        util.validateOidcCreds(params, creds, {
            issuer: (authorizeEndpoint) => authorizeEndpoint.replace(/\/authorize\/?$/, '/'),
            jwksUrl: (issuer) => `${issuer}.well-known/jwks.json`,
            username: (idToken) => idToken.nickname || idToken.email || idToken.sub || '',
        }),
};

export default auth0;
