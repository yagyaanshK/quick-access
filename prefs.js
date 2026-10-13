import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {countEntries} from './src/jumpList.js';

function plural(n, one, many) {
    return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

// A row with a count in its title and a button that resets the key.
function resetRow(settings, key, button, describe) {
    const row = new Adw.ActionRow();
    const reset = new Gtk.Button({label: button, valign: Gtk.Align.CENTER});
    reset.connect('clicked', () => settings.reset(key));
    row.add_suffix(reset);

    const update = () => {
        const n = countEntries(settings.get_value(key).deepUnpack());
        row.title = describe(n);
        reset.sensitive = n > 0;
    };
    settings.connect(`changed::${key}`, update);
    update();
    return row;
}

export default class QuickAccessPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Recent folders',
            description: 'Shown in the sidebar of Open and Save dialogs and of Files.',
        });
        page.add(group);

        const count = new Adw.SpinRow({
            title: 'Number of folders',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 10, step_increment: 1}),
        });
        settings.bind('max-folders', count, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(count);

        const skip = new Adw.SwitchRow({
            title: 'Skip folders already in the sidebar',
            subtitle: 'Your home folder and the bookmarks you added yourself',
        });
        settings.bind('skip-sidebar-folders', skip, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(skip);

        const hiddenGroup = new Adw.PreferencesGroup({
            title: 'Hidden folders',
            description: 'Removing a recent folder from the sidebar hides it for good. ' +
                'Renaming it keeps it as a normal bookmark instead.',
        });
        page.add(hiddenGroup);

        const hidden = new Adw.ActionRow();
        const reset = new Gtk.Button({label: 'Show again', valign: Gtk.Align.CENTER});
        reset.connect('clicked', () => settings.reset('hidden-folders'));
        hidden.add_suffix(reset);
        hiddenGroup.add(hidden);

        const update = () => {
            const n = settings.get_strv('hidden-folders').length;
            hidden.title = n === 0 ? 'No hidden folders'
                : n === 1 ? '1 hidden folder' : `${n} hidden folders`;
            reset.sensitive = n > 0;
        };
        settings.connect('changed::hidden-folders', update);
        update();

        const dockGroup = new Adw.PreferencesGroup({
            title: 'Dock jump lists',
            description: 'Right-click an app in the dock for its pinned and recent files ' +
                'or folders. Hover an entry to pin it or remove it from the list.',
        });
        page.add(dockGroup);

        const jumpLists = new Adw.SwitchRow({title: 'Show jump lists'});
        settings.bind('dock-jump-lists', jumpLists, 'active', Gio.SettingsBindFlags.DEFAULT);
        dockGroup.add(jumpLists);

        const items = new Adw.SpinRow({
            title: 'Number of recent entries',
            subtitle: 'Pinned entries are shown in addition',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 20, step_increment: 1}),
        });
        settings.bind('jump-list-items', items, 'value', Gio.SettingsBindFlags.DEFAULT);
        jumpLists.bind_property('active', items, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
        dockGroup.add(items);

        dockGroup.add(resetRow(settings, 'jump-list-pins', 'Unpin all',
            n => n === 0 ? 'No pinned entries' : plural(n, 'pinned entry', 'pinned entries')));
        dockGroup.add(resetRow(settings, 'jump-list-removed', 'Show again',
            n => n === 0 ? 'No removed entries' : plural(n, 'removed entry', 'removed entries')));
    }
}
