// Dock jump list arithmetic: which recent entries an app's list shows, in
// which order and under which names, and how pins and removals are stored.
// No GNOME imports, so node can test it.

import {decodedPath, isSystemUri} from './recents.js';

const DIRECTORY_TYPE = 'inode/directory';

// Types every file "is", by the shared MIME database's rules. An app that
// lists one of them (a hex editor, say) would otherwise match every file, so
// they only match exactly.
const CATCH_ALL_TYPES = new Set(['application/octet-stream', 'all/all', 'all/allfiles']);

const HIDDEN_PER_APP = 100;

// Whether an app that opens `types` opens a file of type `mime`; isA(mime,
// type) is the MIME database's subclass test (Gio.content_type_is_a).
export function opensType(mime, types, isA) {
    if (!mime || mime === DIRECTORY_TYPE)
        return false;
    return types.some(type => type === mime ||
        (!CATCH_ALL_TYPES.has(type) && isA(mime, type)));
}

// entries: [{uri, mime, time}] from recently-used.xbel. The local files an
// app with these types opens, most recently used first.
export function recentFiles(entries, types, isA) {
    const matches = new Map();
    const opens = mime => {
        if (!matches.has(mime))
            matches.set(mime, opensType(mime, types, isA));
        return matches.get(mime);
    };

    const latest = new Map();
    for (const {uri, mime, time} of entries) {
        if (!uri.startsWith('file:///') || isSystemUri(uri) || !opens(mime))
            continue;
        if (!latest.has(uri) || latest.get(uri) < time)
            latest.set(uri, time);
    }
    return [...latest].sort((a, b) => b[1] - a[1]).map(([uri]) => uri);
}

// The recent entries still to offer: newest first, without the pinned ones
// (they have their own section) and those the user removed.
export function recentCandidates(recent, {pinned = [], removed = []}) {
    const skip = new Set([...pinned, ...removed]);
    return [...new Set(recent)].filter(uri => !skip.has(uri));
}

// The first `count` items that `lookup` resolves to something, in order.
// Lookups run a batch at a time so a long list of vanished files does not
// start hundreds of them at once.
export async function firstFound(items, count, lookup) {
    const found = [];
    for (let i = 0; i < items.length && found.length < count; i += count) {
        const batch = items.slice(i, i + count);
        const results = await Promise.all(batch.map(item => lookup(item)));
        for (const result of results) {
            if (result && found.length < count)
                found.push(result);
        }
    }
    return found;
}

function lastSegment(path) {
    return path.slice(path.lastIndexOf('/') + 1);
}

// The name shown for an entry: the folder or file name, and for a VS Code
// workspace file the workspace name.
export function entryName(uri) {
    const name = lastSegment(decodedPath(uri).replace(/\/+$/, '')) || '/';
    return name.endsWith('.code-workspace') && name !== '.code-workspace'
        ? name.slice(0, -'.code-workspace'.length) : name;
}

// The folders above an entry, outermost first; the home folder counts as one
// folder called "~".
function parentSegments(uri, home) {
    const path = decodedPath(uri).replace(/\/+$/, '');
    const parent = path.slice(0, path.lastIndexOf('/'));
    const homePath = home.replace(/\/+$/, '');
    if (homePath && (parent === homePath || parent.startsWith(`${homePath}/`)))
        return ['~', ...parent.slice(homePath.length).split('/').filter(Boolean)];
    return ['', ...parent.split('/').filter(Boolean)];
}

function joinSegments(segments) {
    if (segments.length === 1 && segments[0] === '')
        return '/';
    return segments.join('/');
}

// Labels for one jump list: {name, detail}. The detail is empty unless two
// entries share a name (ignoring case, as in the sidebar); then it is the
// shortest end of the parent path that tells them apart, e.g. "ubuntu" or
// "~" or "Shared/ubuntu".
export function entryLabels(uris, home = '') {
    const names = uris.map(entryName);
    const keys = names.map(name => name.toLowerCase());
    const details = uris.map(() => '');

    const groups = new Map();
    keys.forEach((key, i) => groups.set(key, [...groups.get(key) ?? [], i]));
    for (const group of groups.values()) {
        if (group.length < 2)
            continue;
        const parents = group.map(i => parentSegments(uris[i], home));
        const longest = Math.max(...parents.map(p => p.length));
        for (let n = 1; n <= longest; n++) {
            const tails = parents.map(p => joinSegments(p.slice(-n)));
            const distinct = new Set(tails.map(t => t.toLowerCase())).size === tails.length;
            if (distinct || n === longest) {
                group.forEach((i, j) => (details[i] = tails[j]));
                break;
            }
        }
    }
    return names.map((name, i) => ({name, detail: details[i]}));
}

// Pins and removals are stored per app: {appId: [uri, ...]}. The transforms
// return new objects and drop apps whose list becomes empty.

function withList(lists, appId, list) {
    const copy = {...lists};
    if (list.length)
        copy[appId] = list;
    else
        delete copy[appId];
    return copy;
}

export function listFor(lists, appId) {
    return Array.isArray(lists?.[appId]) ? lists[appId] : [];
}

// Pins keep the order they were made in; a new one goes last.
export function pin(lists, appId, uri) {
    const list = listFor(lists, appId);
    return list.includes(uri) ? lists : withList(lists, appId, [...list, uri]);
}

export function unpin(lists, appId, uri) {
    return withList(lists, appId, listFor(lists, appId).filter(u => u !== uri));
}

// "Remove from this list": a pinned entry is only unpinned, a recent one is
// hidden from this app's list (newest removal first, capped).
export function removeEntry({pins, removed}, appId, uri) {
    if (listFor(pins, appId).includes(uri))
        return {pins: unpin(pins, appId, uri), removed};
    const list = [uri, ...listFor(removed, appId).filter(u => u !== uri)];
    return {pins, removed: withList(removed, appId, list.slice(0, HIDDEN_PER_APP))};
}

export function countEntries(lists) {
    return Object.values(lists ?? {}).reduce((n, list) => n + list.length, 0);
}
