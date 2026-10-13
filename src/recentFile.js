// Reads GNOME's list of recently used files, ~/.local/share/recently-used.xbel.
// Shared by the sidebar folders and the dock jump lists.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async');

export const DIRECTORY_TYPE = 'inode/directory';

export function recentFile() {
    return Gio.File.new_for_path(
        GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']));
}

// [{uri, mime, isDir, time}], time in seconds. A missing file is an empty list.
export async function readRecentEntries(file, cancellable) {
    const bookmarks = new GLib.BookmarkFile();
    try {
        const [bytes] = await file.load_contents_async(cancellable);
        bookmarks.load_from_data(bytes);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw e;
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            logError(e, 'Quick Access: cannot read recent files');
        return [];
    }

    const entries = [];
    for (const uri of bookmarks.get_uris()) {
        let mime = null;
        let time = 0;
        try {
            mime = bookmarks.get_mime_type(uri);
        } catch {}
        try {
            time = bookmarks.get_modified_date_time(uri).to_unix();
        } catch {}
        entries.push({uri, mime, isDir: mime === DIRECTORY_TYPE, time});
    }
    return entries;
}
