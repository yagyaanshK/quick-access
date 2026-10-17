// Keeps the most recently used folders in the GTK bookmarks file, which is the
// sidebar of every GTK and portal file dialog and of Files.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    isManaged, labelsFor, mergeBookmarks, parseBookmarks, recentFolders, removedByUser,
} from './recents.js';
import {readRecentEntries, recentFile} from './recentFile.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_bytes_async', 'replace_contents_finish');

const SYNC_DELAY_MS = 500;
const MAX_HIDDEN = 100;

function isError(e, code) {
    return e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, code);
}

function ensureParent(file) {
    try {
        file.get_parent().make_directory_with_parents(null);
    } catch (e) {
        if (!isError(e, Gio.IOErrorEnum.EXISTS))
            throw e;
    }
}

async function readTextAsync(file, cancellable) {
    try {
        const [bytes] = await file.load_contents_async(cancellable);
        return new TextDecoder().decode(bytes);
    } catch (e) {
        if (isError(e, Gio.IOErrorEnum.NOT_FOUND))
            return '';
        throw e;
    }
}

async function writeTextAsync(file, text, cancellable) {
    ensureParent(file);
    await file.replace_contents_bytes_async(new GLib.Bytes(new TextEncoder().encode(text)),
        null, false, Gio.FileCreateFlags.NONE, cancellable);
}

// Bookmark updates run one at a time, also across a disable and the next enable
// (the shell does both around the lock screen): the clean-up after disable must
// finish before the next session's first sync reads the file.
let bookmarksQueue = Promise.resolve();

function serialized(task) {
    const run = bookmarksQueue.then(task);
    bookmarksQueue = run.catch(() => {});
    return run;
}

function isFolder(uri) {
    return Gio.File.new_for_uri(uri).query_file_type(Gio.FileQueryInfoFlags.NONE, null) ===
        Gio.FileType.DIRECTORY;
}

function merge(text, folders) {
    const labels = labelsFor(folders);
    return mergeBookmarks(text, folders.map((uri, i) => ({uri, label: labels[i]})));
}

export class QuickAccess {
    constructor(settings) {
        this._settings = settings;
        this._privacy = new Gio.Settings({schema_id: 'org.gnome.desktop.privacy'});
        this._recentFile = recentFile();
        this._bookmarksFile = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_config_dir(), 'gtk-3.0', 'bookmarks']));
        this._cancellable = new Gio.Cancellable();
        this._syncId = 0;
        this._syncing = false;
        this._syncAgain = false;

        // Set from the file by the first sync.
        this._lastWritten = null;

        this._monitors = [this._recentFile, this._bookmarksFile].map(file => {
            const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
            monitor.connectObject('changed', () => this._queueSync(), this);
            return monitor;
        });
        // Only its own keys: the dock jump list settings live in the same schema.
        this._settings.connectObject(
            'changed::max-folders', () => this._queueSync(),
            'changed::skip-sidebar-folders', () => this._queueSync(),
            'changed::hidden-folders', () => this._queueSync(), this);
        this._privacy.connectObject('changed::remember-recent-files',
            () => this._queueSync(), this);

        this._queueSync();
    }

    _queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SYNC_DELAY_MS, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    // One sync at a time; changes that arrive meanwhile run one more.
    async _sync() {
        if (this._syncing) {
            this._syncAgain = true;
            return;
        }
        this._syncing = true;
        try {
            await serialized(() => this._syncOnce());
        } catch (e) {
            if (!isError(e, Gio.IOErrorEnum.CANCELLED))
                logError(e, 'Quick Access');
        } finally {
            this._syncing = false;
        }
        if (this._syncAgain && !this._cancellable.is_cancelled()) {
            this._syncAgain = false;
            this._queueSync();
        }
    }

    async _syncOnce() {
        const text = await readTextAsync(this._bookmarksFile, this._cancellable);
        // Entries left behind by a previous session count as written by us,
        // so they are not mistaken for ones the user removed.
        this._lastWritten ??= parseBookmarks(text).filter(isManaged).map(b => b.uri);
        this._rememberRemoved(text);

        let folders = [];
        if (this._privacy.get_boolean('remember-recent-files')) {
            const exclude = new Set(this._settings.get_strv('hidden-folders'));
            if (this._settings.get_boolean('skip-sidebar-folders')) {
                exclude.add(Gio.File.new_for_path(GLib.get_home_dir()).get_uri());
                for (const bookmark of parseBookmarks(text).filter(b => !isManaged(b)))
                    exclude.add(bookmark.uri);
            }
            folders = recentFolders(await readRecentEntries(this._recentFile, this._cancellable), {
                limit: this._settings.get_int('max-folders'),
                exclude,
                isUsable: isFolder,
            });
        }

        const merged = merge(text, folders);
        if (merged !== text)
            await writeTextAsync(this._bookmarksFile, merged, this._cancellable);
        this._lastWritten = folders;
    }

    _rememberRemoved(text) {
        const removed = removedByUser(this._lastWritten, text);
        if (!removed.length)
            return;
        const hidden = this._settings.get_strv('hidden-folders').filter(u => !removed.includes(u));
        this._settings.set_strv('hidden-folders', [...removed, ...hidden].slice(0, MAX_HIDDEN));
    }

    destroy() {
        this._cancellable.cancel();
        if (this._syncId) {
            GLib.source_remove(this._syncId);
            this._syncId = 0;
        }
        for (const monitor of this._monitors) {
            monitor.disconnectObject(this);
            monitor.cancel();
        }
        this._monitors = [];
        this._settings.disconnectObject(this);
        this._privacy.disconnectObject(this);

        // Leave only the user's own bookmarks behind. Not cancellable: it has to
        // finish even though this instance is gone.
        const file = this._bookmarksFile;
        serialized(async () => {
            const text = await readTextAsync(file, null);
            const merged = merge(text, []);
            if (merged !== text)
                await writeTextAsync(file, merged, null);
        }).catch(e => logError(e, 'Quick Access'));
    }
}
