import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {QuickAccess} from './src/quickAccess.js';

export default class QuickAccessExtension extends Extension {
    enable() {
        this._quickAccess = new QuickAccess(this.getSettings());
    }

    disable() {
        this._quickAccess?.destroy();
        this._quickAccess = null;
    }
}
