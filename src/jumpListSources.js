// Works out the entries of an app's dock jump list in the background: reads
// recently-used.xbel and VS Code's history (each only when it changed), and
// checks that the entries still exist. The last list of each app is kept so a
// menu can show it at once while a fresh one is worked out.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {FOLDERS, VSCODE, providerFor, vscodeRecents, vscodeWindows} from './apps.js';
import {firstFound, listFor, recentCandidates, recentFiles} from './jumpList.js';
import {readRecentEntries, recentFile} from './recentFile.js';
import {recentFolders} from './recents.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'query_info_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const HELPER_TIMEOUT_S = 5;
const STAMP_ATTRIBUTES = 'time::modified,time::modified-usec,standard::size';
const ENTRY_ATTRIBUTES = 'standard::type,standard::symbolic-icon';

function isCancelled(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

function isNotFound(e) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
}

export class JumpListSources {
    constructor(settings, helperPath) {
        this._settings = settings;
        this._helperPath = helperPath;
        this._privacy = new Gio.Settings({schema_id: 'org.gnome.desktop.privacy'});
        this._recentFile = recentFile();
        this._cancellable = new Gio.Cancellable();
        this._recent = {stamp: null, entries: []};
        this._vscode = new Map();
        this._lists = new Map();
        this._helpers = new Set();
        this._reported = new Set();
    }

    // How the app's list is filled (see providerFor), or null for none.
    providerOf(app) {
        const appInfo = app.get_app_info();
        return providerFor(app.get_id(), appInfo?.get_supported_types?.() ?? []);
    }

    // The app's list as last worked out, or null:
    // {pinned: [entry], recent: [entry]}, entry = {uri, path, isDir, icon}.
    cached(appId) {
        return this._lists.get(appId) ?? null;
    }

    // Reads recently-used.xbel ahead of the first menu.
    warm() {
        this._recentEntries().catch(e => {
            if (!isCancelled(e))
                logError(e, 'Quick Access');
        });
    }

    async refresh(app, provider) {
        const appId = app.get_id();
        const pins = listFor(this._settings.get_value('jump-list-pins').deepUnpack(), appId);
        const removed = listFor(this._settings.get_value('jump-list-removed').deepUnpack(), appId);
        const limit = this._settings.get_int('jump-list-items');

        // With File History off in Privacy settings only the pins are shown.
        const recent = this._privacy.get_boolean('remember-recent-files')
            ? await this._recentUris(provider) : [];

        const lookup = uri => this._lookup(uri);
        const [pinned, shown] = await Promise.all([
            firstFound(pins, pins.length, lookup),
            firstFound(recentCandidates(recent, {pinned: pins, removed}), limit, lookup),
        ]);
        const list = {pinned, recent: shown};
        this._lists.set(appId, list);
        return list;
    }

    async _recentUris(provider) {
        switch (provider.kind) {
        case FOLDERS:
            return recentFolders(await this._recentEntries(), {limit: Infinity});
        case VSCODE: {
            const lists = await Promise.all(provider.configDirs.map(dir => this._vscodeUris(dir)));
            return [...new Set(lists.flat())];
        }
        default:
            return recentFiles(await this._recentEntries(), provider.types,
                (mime, type) => Gio.content_type_is_a(mime, type));
        }
    }

    // Changes whenever the file does; 'missing' if it does not exist.
    async _stamp(file) {
        try {
            const info = await file.query_info_async(STAMP_ATTRIBUTES,
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this._cancellable);
            return [
                info.get_attribute_uint64('time::modified'),
                info.get_attribute_uint32('time::modified-usec'),
                info.get_size(),
            ].join(':');
        } catch (e) {
            if (isCancelled(e))
                throw e;
            return 'missing';
        }
    }

    async _recentEntries() {
        const stamp = await this._stamp(this._recentFile);
        if (stamp !== this._recent.stamp) {
            const entries = await readRecentEntries(this._recentFile, this._cancellable);
            this._recent = {stamp, entries};
        }
        return this._recent.entries;
    }

    // VS Code's recently opened folders and workspaces, followed by the
    // folders of its open windows.
    async _vscodeUris({base, path}) {
        const root = base === 'home' ? GLib.get_home_dir() : GLib.get_user_config_dir();
        const dir = Gio.File.new_for_path(GLib.build_filenamev([root, path, 'User', 'globalStorage']));
        const database = dir.get_child('state.vscdb');
        const storage = dir.get_child('storage.json');

        const stamps = await Promise.all([this._stamp(database), this._stamp(storage)]);
        const stamp = stamps.join();
        const cached = this._vscode.get(dir.get_path());
        if (cached?.stamp === stamp)
            return cached.uris;

        const [recentJson, storageJson] = await Promise.all([
            stamps[0] === 'missing' ? '' : this._readDatabase(database),
            this._readText(storage),
        ]);
        const uris = [...new Set([...vscodeRecents(recentJson), ...vscodeWindows(storageJson)])];
        this._vscode.set(dir.get_path(), {stamp, uris});
        return uris;
    }

    async _readText(file) {
        try {
            const [bytes] = await file.load_contents_async(this._cancellable);
            return new TextDecoder().decode(bytes);
        } catch (e) {
            if (isCancelled(e))
                throw e;
            if (!isNotFound(e))
                this._reportOnce(file.get_path(), e);
            return '';
        }
    }

    // state.vscdb is SQLite, which GNOME Shell cannot read itself; a short
    // Python script reads it read-only in a separate process.
    async _readDatabase(file) {
        let proc;
        try {
            proc = Gio.Subprocess.new(['python3', '-I', this._helperPath, file.get_path()],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (e) {
            this._reportOnce('python3', e);
            return '';
        }

        this._helpers.add(proc);
        let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, HELPER_TIMEOUT_S, () => {
            timeoutId = 0;
            proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        try {
            const [stdout, stderr] = await proc.communicate_utf8_async(null, this._cancellable);
            if (!proc.get_successful()) {
                this._reportOnce(file.get_path(), new Error(stderr?.trim() || 'cannot read'));
                return '';
            }
            return stdout ?? '';
        } finally {
            if (timeoutId)
                GLib.source_remove(timeoutId);
            this._helpers.delete(proc);
        }
    }

    _reportOnce(key, error) {
        if (this._reported.has(key))
            return;
        this._reported.add(key);
        console.warn(`Quick Access: ${key}: ${error.message}`);
    }

    // The entry if it still exists, with the icon Files would show for it.
    async _lookup(uri) {
        const file = Gio.File.new_for_uri(uri);
        try {
            const info = await file.query_info_async(ENTRY_ATTRIBUTES,
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this._cancellable);
            return {
                uri,
                path: file.get_path(),
                isDir: info.get_file_type() === Gio.FileType.DIRECTORY,
                icon: info.get_symbolic_icon(),
            };
        } catch (e) {
            if (isCancelled(e))
                throw e;
            return null;
        }
    }

    destroy() {
        this._cancellable.cancel();
        for (const proc of this._helpers)
            proc.force_exit();
        this._helpers.clear();
        this._lists.clear();
        this._vscode.clear();
    }
}
