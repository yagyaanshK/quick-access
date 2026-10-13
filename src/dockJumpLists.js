// Adds a jump list to the right-click menu of app icons, as on Windows 11: the
// entries pinned for that app, then its recent files or folders. Works for
// Ubuntu Dock and Dash to Dock, and for GNOME's own dash and app grid.
//
// App menus are picked up as they join the shell's UI group, so neither the
// dock's code nor any shared prototype is patched, and disabling removes
// exactly what was added.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {commandForFile, newWindowAction} from './apps.js';
import {entryLabels, pin, removeEntry, unpin} from './jumpList.js';
import {JumpListSources} from './jumpListSources.js';

const TOOLTIP_DELAY_MS = 600;
const TOOLTIP_FADE_MS = 150;
const TOOLTIP_GAP = 4;
const DETAIL_OPACITY = 140;

function isMiddleClick(event) {
    const type = event?.type();
    return (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.BUTTON_RELEASE) &&
        event.get_button() === Clutter.BUTTON_MIDDLE;
}

function themedIcon(...names) {
    return Gio.ThemedIcon.new_from_names(names);
}

// One entry: icon, name (plus a dim parent when names clash) and, while the
// row is hovered or focused, a pin and a remove button at its end.
const JumpListItem = GObject.registerClass({
    Signals: {
        'toggle-pin': {},
        'remove-entry': {},
    },
}, class JumpListItem extends PopupMenu.PopupBaseMenuItem {
    _init(entry, {name, detail}, pinned) {
        super._init({style_class: 'quick-access-jump-item'});
        this.entry = entry;

        this.add_child(new St.Icon({
            gicon: entry.icon ?? themedIcon(entry.isDir ? 'folder-symbolic' : 'text-x-generic-symbolic'),
            style_class: 'popup-menu-icon',
        }));

        this.label = new St.Label({text: name, y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this.label);
        this.label_actor = this.label;

        if (detail) {
            this.add_child(new St.Label({
                text: `— ${detail}`,
                style_class: 'quick-access-jump-detail',
                y_align: Clutter.ActorAlign.CENTER,
                opacity: DETAIL_OPACITY,
            }));
        }

        this._buttons = new St.BoxLayout({
            style_class: 'quick-access-jump-buttons',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        this.add_child(this._buttons);
        this._addButton('toggle-pin', pinned ? 'Unpin from this list' : 'Pin to this list',
            pinned ? themedIcon('view-unpin-symbolic', 'adw-tab-unpin-symbolic', 'view-pin-symbolic')
                : themedIcon('view-pin-symbolic'), pinned);
        this._addButton('remove-entry', 'Remove from this list', themedIcon('window-close-symbolic'), false);

        this.connect('notify::active', () => this._syncButtons());
        this._syncButtons();
    }

    _addButton(signal, accessibleName, gicon, checked) {
        const button = new St.Button({
            style_class: 'quick-access-jump-button',
            child: new St.Icon({gicon}),
            accessible_name: accessibleName,
            can_focus: false,
            checked,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', () => this.emit(signal));
        this._buttons.add_child(button);
    }

    // The buttons keep their space so the label does not move, but are only
    // visible and clickable on the active row.
    _syncButtons() {
        this._buttons.opacity = this.active ? 255 : 0;
        for (const button of this._buttons.get_children())
            button.reactive = this.active;
    }

    get pinButton() {
        return this._buttons.get_child_at_index(0);
    }

    get removeButton() {
        return this._buttons.get_child_at_index(1);
    }
});

// The full path of the hovered entry, in the style of the dash's app names.
class PathTooltip {
    constructor() {
        this._label = new St.Label({
            style_class: 'dash-label quick-access-jump-tooltip',
            visible: false,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
        Main.uiGroup.add_child(this._label);
        this._item = null;
        this._timeoutId = 0;
    }

    get text() {
        return this._label.visible ? this._label.text : null;
    }

    showFor(item) {
        this.hide();
        this._item = item;
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
            this._timeoutId = 0;
            this._show();
            return GLib.SOURCE_REMOVE;
        });
    }

    hideFor(item) {
        if (this._item === item)
            this.hide();
    }

    hide() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._item = null;
        this._label.remove_all_transitions();
        this._label.hide();
    }

    // Below the row, lined up with its name; above it near the screen edge.
    _show() {
        const item = this._item;
        if (!item?.mapped)
            return;

        this._label.text = item.entry.path;
        this._label.opacity = 0;
        this._label.show();
        Main.uiGroup.set_child_above_sibling(this._label, null);

        const [labelX] = item.label.get_transformed_position();
        const [, itemY] = item.get_transformed_position();
        const [, itemHeight] = item.get_transformed_size();
        const [, width] = this._label.get_preferred_width(-1);
        const [, height] = this._label.get_preferred_height(width);
        const monitor = Main.layoutManager.findMonitorForActor(item) ?? Main.layoutManager.primaryMonitor;

        const x = Math.max(monitor.x, Math.min(labelX, monitor.x + monitor.width - width));
        let y = itemY + itemHeight + TOOLTIP_GAP;
        if (y + height > monitor.y + monitor.height)
            y = itemY - height - TOOLTIP_GAP;
        this._label.set_position(Math.round(x), Math.round(y));
        this._label.ease({
            opacity: 255,
            duration: TOOLTIP_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    destroy() {
        this.hide();
        this._label.destroy();
    }
}

export class DockJumpLists {
    constructor(settings, extensionPath) {
        this._settings = settings;
        this._sources = new JumpListSources(settings,
            GLib.build_filenamev([extensionPath, 'src', 'vscdb.py']));
        this._tooltip = new PathTooltip();
        // menu -> {menu, section, separator, app, provider, serial, shown}
        this._menus = new Map();

        Main.uiGroup.connectObject('child-added', (group, actor) => this._watch(actor), this);
        for (const actor of Main.uiGroup.get_children())
            this._watch(actor);

        this._sources.warm();
    }

    // App icon menus (the shell's AppMenu, the dock's own) carry 'app-menu'.
    _watch(actor) {
        const menu = actor._delegate;
        if (!(menu instanceof PopupMenu.PopupMenu) || this._menus.has(menu) ||
            !actor.has_style_class_name('app-menu'))
            return;

        this._menus.set(menu, {menu, section: null, separator: null, serial: 0, shown: null});
        menu.connectObject(
            'open-state-changed', (m, open) => {
                if (open)
                    this._onOpen(menu);
                else
                    this._tooltip.hide();
            },
            'destroy', () => this._forget(menu),
            this);
        if (menu.isOpen)
            this._onOpen(menu);
    }

    _forget(menu) {
        menu.disconnectObject(this);
        this._menus.delete(menu);
    }

    _onOpen(menu) {
        const state = this._menus.get(menu);
        const app = menu.sourceActor?.app;
        if (!(app instanceof Shell.App) || app.is_window_backed() || !app.get_id()?.endsWith('.desktop'))
            return;
        const provider = this._sources.providerOf(app);
        if (!provider)
            return;

        state.app = app;
        state.provider = provider;
        // The dock rebuilds its menu on every open, the shell keeps its own.
        if (!state.section || !state.separator)
            this._insert(menu, state);
        this._render(state, this._sources.cached(app.get_id()));
        this._refresh(state);
    }

    // At the top of the menu, below the dock's title (the app's name) if it
    // has one, with a separator before the app's own items.
    _insert(menu, state) {
        state.section?.destroy();
        state.separator?.destroy();

        const first = menu.firstMenuItem;
        const titled = first instanceof PopupMenu.PopupSeparatorMenuItem &&
            first.label.text !== '' && first.label.text.includes(state.app.get_name());
        const position = titled ? 1 : 0;

        const section = new PopupMenu.PopupMenuSection();
        const separator = new PopupMenu.PopupSeparatorMenuItem();
        menu.addMenuItem(section, position);
        menu.addMenuItem(separator, position + 1);
        section.actor.add_style_class_name('quick-access-jump-list');

        section.connect('destroy', () => {
            if (state.section === section)
                state.section = null;
        });
        separator.connect('destroy', () => {
            if (state.separator === separator)
                state.separator = null;
        });
        Object.assign(state, {section, separator, shown: null});
    }

    _refresh(state) {
        const serial = ++state.serial;
        this._sources.refresh(state.app, state.provider).then(list => {
            if (this._menus.get(state.menu) === state && state.serial === serial && state.menu.isOpen)
                this._render(state, list);
        }).catch(e => {
            if (!(e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)))
                logError(e, 'Quick Access: jump list');
        });
    }

    _render(state, list) {
        const {section, separator} = state;
        if (!section || !separator)
            return;

        // Unchanged lists are left alone, so a hovered row stays hovered.
        const pinned = list?.pinned ?? [];
        const recent = list?.recent ?? [];
        const shown = JSON.stringify([state.app.get_id(), pinned.map(e => e.uri), recent.map(e => e.uri)]);
        if (shown === state.shown)
            return;
        state.shown = shown;

        this._tooltip.hide();
        section.removeAll();
        const labels = entryLabels([...pinned, ...recent].map(entry => entry.uri), GLib.get_home_dir());

        // Each heading starts a section of its own, which is what the theme
        // styles as a heading in app menus.
        const addGroup = (title, entries, firstLabel, pinnedGroup) => {
            if (!entries.length)
                return;
            const group = new PopupMenu.PopupMenuSection();
            group.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(title));
            entries.forEach((entry, i) =>
                group.addMenuItem(this._row(state, entry, labels[firstLabel + i], pinnedGroup)));
            section.addMenuItem(group);
        };
        addGroup('Pinned', pinned, 0, true);
        addGroup(state.provider.title, recent, pinned.length, false);

        separator.visible = pinned.length + recent.length > 0 && !this._separatorFollows(separator);
    }

    // Whether the next visible item of the menu already is a separator.
    _separatorFollows(separator) {
        const children = separator.get_parent()?.get_children() ?? [];
        const next = children.slice(children.indexOf(separator) + 1).find(child => child.visible);
        return next?._delegate instanceof PopupMenu.PopupSeparatorMenuItem;
    }

    _row(state, entry, label, pinned) {
        const item = new JumpListItem(entry, label, pinned);
        item.connect('activate', (o, event) => this._open(state.app, entry, isMiddleClick(event)));
        item.connect('toggle-pin', () => this._togglePin(state, entry.uri, pinned));
        item.connect('remove-entry', () => this._remove(state, entry.uri));
        item.connect('notify::active', () => {
            if (item.active)
                this._tooltip.showFor(item);
            else
                this._tooltip.hideFor(item);
        });
        item.connect('destroy', () => this._tooltip.hideFor(item));
        return item;
    }

    _lists() {
        return {
            pins: this._settings.get_value('jump-list-pins').deepUnpack(),
            removed: this._settings.get_value('jump-list-removed').deepUnpack(),
        };
    }

    _store({pins, removed}) {
        this._settings.set_value('jump-list-pins', new GLib.Variant('a{sas}', pins));
        this._settings.set_value('jump-list-removed', new GLib.Variant('a{sas}', removed));
    }

    // Both keep the menu open; the list is redrawn in place once worked out.
    _togglePin(state, uri, pinned) {
        const lists = this._lists();
        const appId = state.app.get_id();
        lists.pins = pinned ? unpin(lists.pins, appId, uri) : pin(lists.pins, appId, uri);
        this._store(lists);
        this._refresh(state);
    }

    _remove(state, uri) {
        this._store(removeEntry(this._lists(), state.app.get_id(), uri));
        this._refresh(state);
    }

    // A click opens the entry with the app, a middle click in a new window.
    _open(app, entry, newWindow) {
        const appInfo = app.get_app_info();
        try {
            this._launch(appInfo, entry.uri, newWindow ? this._newWindowCommand(appInfo, entry) : null);
        } catch (e) {
            logError(e, `Quick Access: cannot open ${entry.uri}`);
        }
        Main.overview.hide();
    }

    // The app's "new window" desktop action with the entry added, or null.
    _newWindowCommand(appInfo, entry) {
        const action = newWindowAction(appInfo.list_actions());
        if (!action || !appInfo.get_filename())
            return null;
        const keyFile = new GLib.KeyFile();
        keyFile.load_from_file(appInfo.get_filename(), GLib.KeyFileFlags.NONE);
        const [, argv] = GLib.shell_parse_argv(keyFile.get_string(`Desktop Action ${action}`, 'Exec'));
        return commandForFile(argv, {path: entry.path, uri: entry.uri});
    }

    _launch(appInfo, uri, command) {
        const context = global.create_app_launch_context(0, -1);
        if (!command) {
            appInfo.launch_uris([uri], context);
            return;
        }
        // Exec quoting: shell quoting, and '%' doubled.
        const commandline = command.map(arg => GLib.shell_quote(arg).replace(/%/g, '%%')).join(' ');
        Gio.AppInfo.create_from_commandline(commandline, appInfo.get_name(),
            Gio.AppInfoCreateFlags.NONE).launch([], context);
    }

    destroy() {
        Main.uiGroup.disconnectObject(this);
        for (const [menu, state] of this._menus) {
            menu.disconnectObject(this);
            state.serial++;
            state.section?.destroy();
            state.separator?.destroy();
        }
        this._menus.clear();
        this._tooltip.destroy();
        this._sources.destroy();
    }
}
