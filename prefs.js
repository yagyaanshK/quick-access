import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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
    }
}
