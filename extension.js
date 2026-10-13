import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {DockJumpLists} from './src/dockJumpLists.js';
import {QuickAccess} from './src/quickAccess.js';

export default class QuickAccessExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._quickAccess = new QuickAccess(this._settings);
        this._settings.connectObject('changed::dock-jump-lists', () => this._syncJumpLists(), this);
        this._syncJumpLists();
    }

    _syncJumpLists() {
        const wanted = this._settings.get_boolean('dock-jump-lists');
        if (wanted && !this._jumpLists) {
            this._jumpLists = new DockJumpLists(this._settings, this.path);
        } else if (!wanted && this._jumpLists) {
            this._jumpLists.destroy();
            this._jumpLists = null;
        }
    }

    disable() {
        this._settings?.disconnectObject(this);
        this._jumpLists?.destroy();
        this._jumpLists = null;
        this._quickAccess?.destroy();
        this._quickAccess = null;
        this._settings = null;
    }
}
