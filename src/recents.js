// Quick Access arithmetic: which folders count as recent, what they are called
// and how they sit in the GTK bookmarks file. No GNOME imports, so node can
// test it.

// Marks the bookmarks Quick Access manages; anything without it belongs to the
// user. Renaming an entry drops the mark, which is how a folder gets pinned.
export const MARK = '\u{1F558} ';

const SYSTEM_PREFIXES = ['/tmp/', '/var/tmp/', '/proc/', '/sys/', '/dev/', '/run/user/'];

// The folder a recent entry stands for: the entry itself for a folder, the
// containing folder for a file. Only local paths, never the root.
export function folderUriOf(uri, isDir) {
    if (!uri.startsWith('file:///'))
        return null;

    const path = uri.slice('file://'.length).replace(/\/+$/, '');
    const folder = isDir ? path : path.slice(0, path.lastIndexOf('/'));
    if (folder === '')
        return null;
    return `file://${folder}`;
}

function decodedPath(uri) {
    try {
        return decodeURIComponent(uri.slice('file://'.length));
    } catch {
        return uri.slice('file://'.length);
    }
}

function isHiddenOrSystem(uri) {
    const path = decodedPath(uri);
    if (SYSTEM_PREFIXES.some(prefix => `${path}/`.startsWith(prefix)))
        return true;
    return path.split('/').some(part => part.startsWith('.'));
}

// entries: [{uri, isDir, time}] from recently-used.xbel, time in seconds.
// Returns folder URIs, most recently used first.
export function recentFolders(entries, {limit, exclude = new Set(), isUsable = () => true}) {
    const latest = new Map();
    for (const {uri, isDir, time} of entries) {
        const folder = folderUriOf(uri, isDir);
        if (!folder || exclude.has(folder) || isHiddenOrSystem(folder))
            continue;
        if (!latest.has(folder) || latest.get(folder) < time)
            latest.set(folder, time);
    }

    const folders = [];
    for (const [folder] of [...latest].sort((a, b) => b[1] - a[1])) {
        if (folders.length >= limit)
            break;
        if (isUsable(folder))
            folders.push(folder);
    }
    return folders;
}

function lastSegment(path) {
    return path.slice(path.lastIndexOf('/') + 1);
}

// Sidebar labels: the folder name, plus its parent's name when two recent
// folders share a name (ignoring case, which is easy to miss in a sidebar).
export function labelsFor(folders) {
    const names = folders.map(uri => lastSegment(decodedPath(uri)));
    const keys = names.map(name => name.toLowerCase());
    return folders.map((uri, i) => {
        const clash = keys.some((key, j) => j !== i && key === keys[i]);
        if (!clash)
            return `${MARK}${names[i]}`;
        const path = decodedPath(uri);
        const parent = lastSegment(path.slice(0, path.lastIndexOf('/'))) || '/';
        return `${MARK}${names[i]} (${parent})`;
    });
}

// The GTK bookmarks file: one "URI [label]" per line.
export function parseBookmarks(text) {
    return text.split('\n').filter(line => line.trim() !== '').map(line => {
        const space = line.indexOf(' ');
        return space === -1
            ? {uri: line, label: null, line}
            : {uri: line.slice(0, space), label: line.slice(space + 1), line};
    });
}

export function isManaged(bookmark) {
    return bookmark.label !== null && bookmark.label.startsWith(MARK);
}

// The user's own bookmarks, in their order, followed by the recent folders.
export function mergeBookmarks(text, recents) {
    const own = parseBookmarks(text).filter(b => !isManaged(b)).map(b => b.line);
    const managed = recents.map(({uri, label}) => `${uri} ${label}`);
    const lines = [...own, ...managed];
    return lines.length ? `${lines.join('\n')}\n` : '';
}

// Recent folders the user removed from the sidebar: managed URIs written last
// time that are gone from the file now, unless they came back as their own
// (renamed, so pinned) bookmark.
export function removedByUser(lastWritten, text) {
    const present = new Set(parseBookmarks(text).map(b => b.uri));
    return lastWritten.filter(uri => !present.has(uri));
}
