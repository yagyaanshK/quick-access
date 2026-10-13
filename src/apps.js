// Which apps get which jump list, what VS Code remembers, and the command for
// opening an entry in a new window. No GNOME imports, so node can test it.

export const FOLDERS = 'folders';
export const FILES = 'files';
export const VSCODE = 'vscode';

// VS Code and its rebuilds, by desktop file: the folder that holds their
// settings, under ~/.config, or under the Flatpak's own config folder.
const VSCODE_CONFIG = {
    'com.microsoft.VSCode.desktop': 'Code',
    'code.desktop': 'Code',
    'code_code.desktop': 'Code',
    'code-insiders.desktop': 'Code - Insiders',
    'code-oss.desktop': 'Code - OSS',
    'codium.desktop': 'VSCodium',
    'codium_codium.desktop': 'VSCodium',
};
const VSCODE_FLATPAK_CONFIG = {
    'com.visualstudio.code.desktop': 'Code',
    'com.visualstudio.code.oss.desktop': 'Code - OSS',
    'com.vscodium.codium.desktop': 'VSCodium',
};

const FILE_MANAGERS = new Set(['org.gnome.Nautilus.desktop', 'nautilus.desktop']);

// How an app's jump list is filled:
//   {kind: FOLDERS}                     recent folders, as in the sidebar
//   {kind: VSCODE, configDirs}          VS Code's own recently opened list
//   {kind: FILES, types}                recent files of the types it opens
// or null for an app that opens no files. Text Editor needs nothing special:
// it opens text/plain, and every text format is a kind of text/plain.
export function providerFor(appId, supportedTypes = []) {
    if (FILE_MANAGERS.has(appId))
        return {kind: FOLDERS, title: 'Recent Folders'};

    const configDirs = vscodeConfigDirs(appId);
    if (configDirs.length)
        return {kind: VSCODE, title: 'Recent Folders', configDirs};

    const types = supportedTypes.filter(type => type !== 'inode/directory');
    return types.length ? {kind: FILES, title: 'Recent Files', types} : null;
}

// Each entry is {base, path}: base 'config' is ~/.config ($XDG_CONFIG_HOME),
// 'home' is the home folder.
function vscodeConfigDirs(appId) {
    if (VSCODE_CONFIG[appId])
        return [{base: 'config', path: VSCODE_CONFIG[appId]}];
    if (VSCODE_FLATPAK_CONFIG[appId]) {
        const flatpakId = appId.slice(0, -'.desktop'.length);
        return [{base: 'home', path: `.var/app/${flatpakId}/config/${VSCODE_FLATPAK_CONFIG[appId]}`}];
    }
    return [];
}

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function isLocal(uri) {
    return typeof uri === 'string' && uri.startsWith('file:///');
}

function unique(uris) {
    return [...new Set(uris.filter(isLocal))];
}

// A file URI for a local path; anything that is already a URI stays as it is.
function toUri(pathOrUri) {
    if (typeof pathOrUri !== 'string' || !pathOrUri.startsWith('/'))
        return pathOrUri;
    return `file://${pathOrUri.split('/').map(encodeURIComponent).join('/')}`;
}

// The value of 'history.recentlyOpenedPathsList' in VS Code's state.vscdb:
// {entries: [{folderUri} | {workspace: {configPath}} | {fileUri}, ...]},
// newest first. The folders and workspaces; files stay out of a folder list.
export function vscodeRecents(json) {
    const entries = parseJson(json)?.entries;
    if (!Array.isArray(entries))
        return [];
    return unique(entries.map(entry => entry?.folderUri ?? entry?.workspace?.configPath));
}

// The recently opened list as VS Code versions from before
// 'history.recentlyOpenedPathsList' kept it, in storage.json's
// 'openedPathsList': 'workspaces3' holds folder URIs and {configURIPath}
// workspaces; the older 'workspaces2' and 'workspaces' hold paths and
// {configPath}. Newest first.
export function vscodeOpenedPaths(json) {
    const list = parseJson(json)?.openedPathsList;
    if (!list)
        return [];
    const items = ['workspaces3', 'workspaces2', 'workspaces']
        .flatMap(key => Array.isArray(list[key]) ? list[key] : []);
    return unique(items.map(item => toUri(typeof item === 'string' ? item : item?.configURIPath ?? item?.configPath)));
}

// VS Code's workspaceStorage holds a folder for every folder or workspace it
// has opened, with a workspace.json naming it ({folder} or {workspace}, a
// .code-workspace file). Current versions keep no other recently opened list,
// so this is it: [{json: workspace.json text, time: last used}], newest first.
export function vscodeWorkspaces(items) {
    const sorted = [...items].sort((a, b) => b.time - a.time);
    return unique(sorted.map(({json}) => {
        const workspace = parseJson(json);
        return workspace?.folder ?? workspace?.workspace;
    }));
}

// storage.json's 'windowsState': the folders of the windows open when VS Code
// last saved it, the last active one first. Covers a recent list that was
// cleared while windows stayed open.
export function vscodeWindows(json) {
    const state = parseJson(json)?.windowsState;
    if (!state)
        return [];
    const windows = [state.lastActiveWindow, ...Array.isArray(state.openedWindows) ? state.openedWindows : []];
    // Older versions named the folder by its path ('folderPath') or as
    // 'folderUri', and a workspace by {configPath}.
    return unique(windows.map(w => toUri(w?.folder ?? w?.folderUri ?? w?.folderPath ??
        w?.workspaceIdentifier?.configURIPath ?? w?.workspace?.configPath)));
}

// The desktop file action that opens a new window, if it has one.
export function newWindowAction(actions) {
    return ['new-window', 'new-empty-window'].find(action => actions.includes(action)) ?? null;
}

// A desktop entry command line, split into arguments, made to open one file:
// its file field codes become the file, the others go, and a command without
// one gets the file at the end (as in "nautilus --new-window").
export function commandForFile(argv, {path, uri}) {
    const command = [];
    let placed = false;
    for (const arg of argv) {
        if (arg === '%f' || arg === '%F') {
            command.push(path);
            placed = true;
        } else if (arg === '%u' || arg === '%U') {
            command.push(uri);
            placed = true;
        } else if (!/^%[a-zA-Z]$/.test(arg)) {
            command.push(arg.replace(/%%/g, '%'));
        }
    }
    if (!placed)
        command.push(path);
    return command;
}
