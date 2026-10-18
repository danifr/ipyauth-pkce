/**
 * Central provider registry.
 *
 * To add a new provider: create a provider file in this directory and
 * import/register it here.
 *
 * To remove a provider: delete its import line and
 * remove it from the registry object below. No other files need to change.
 */

import keycloak from './keycloak';
import auth0 from './auth0';
import google from './google';

const registry = {
    keycloak,
    auth0,
    google,
};

export default registry;
