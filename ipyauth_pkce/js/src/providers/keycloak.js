import util from '../widget_util';

const keycloak = {
    name: 'keycloak',
    url_params: {},
    isValid: (params, creds) =>
        util.validateOidcCreds(params, creds, {
            issuer: (authorizeEndpoint) =>
                authorizeEndpoint.replace(/\/protocol\/openid-connect\/auth\/?$/, ''),
            jwksUrl: (issuer) => `${issuer}/protocol/openid-connect/certs`,
            username: (idToken) => idToken.email,
        }),
};

export default keycloak;
