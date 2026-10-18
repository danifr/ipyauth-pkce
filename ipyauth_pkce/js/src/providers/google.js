import util from '../widget_util';

// https://developers.google.com/identity/protocols/oauth2/web-server
const google = {
    name: 'google',
    authorize_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token',
    url_params: {
        access_type: 'online',
    },
    isValid: async (params, creds) => {
        const { url_params } = params;
        function useEmpty(error) {
            console.warn('Response tokeninfo or userinfo: ERROR', error);
            return {};
        }

        const tokenInfoUrl = 'https://www.googleapis.com/oauth2/v3/tokeninfo';
        const userInfoUrl = 'https://www.googleapis.com/oauth2/v3/userinfo';
        const headers = { Authorization: `Bearer ${creds.access_token}` };

        const [tokenInfo, userInfo] = await Promise.all([
            fetch(tokenInfoUrl, { headers })
                .then((r) => r.json())
                .catch(useEmpty),
            fetch(userInfoUrl, { headers })
                .then((r) => r.json())
                .catch(useEmpty),
        ]);

        creds.tokeninfo = tokenInfo;
        creds.userinfo = userInfo;

        if (!creds.tokeninfo || !creds.tokeninfo.aud) {
            return [false, creds];
        }

        if (!creds.userinfo || !creds.userinfo.name) {
            return [false, creds];
        }

        if (creds.id_token) {
            const claimsValid = await util.validateIdToken(
                creds.id_token,
                {
                    issuer: 'https://accounts.google.com',
                    audience: url_params.client_id,
                    nonce: url_params.nonce,
                    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
                },
                creds.id_token_raw
            );
            if (!claimsValid) {
                return [false, creds];
            }
        }

        // check aud = client_id
        const audienceValid = url_params.client_id === creds.tokeninfo.aud;
        // collect scope from tokeninfo
        creds.scope = creds.tokeninfo.scope || url_params.scope;
        // set expiry
        const now = new Date();
        creds.expiry = new Date(now.getTime() + creds.expires_in * 1000);
        // set username
        creds.username = creds.userinfo.name;
        return [audienceValid, creds];
    },
};

export default google;
