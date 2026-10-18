import * as base from '@jupyter-widgets/base';

import * as myWidget from './widget';
import packageJson from '../package.json';
import { setCommandRegistry } from './app_commands';

const id = 'ipyauth-pkce';
const requires = [base.IJupyterWidgetRegistry];
const autoStart = true;

const activate = (app, widgets) => {
    console.log('JupyterLab extension ipyauth-pkce is activated!');

    // Capture the command registry so the widget can move the notebook
    // selection off the auth cell after a successful sign-in.
    if (app && app.commands) {
        setCommandRegistry(app.commands);
    }

    widgets.registerWidget({
        name: 'ipyauth-pkce',
        version: packageJson.version,
        exports: myWidget,
    });
};

export default {
    id,
    requires,
    activate,
    autoStart,
};
