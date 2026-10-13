import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    FILES, FOLDERS, VSCODE, commandForFile, newWindowAction, providerFor, vscodeOpenedPaths,
    vscodeRecents, vscodeWindows, vscodeWorkspaces,
} from '../src/apps.js';

test('Files lists folders, VS Code its own list, other apps files of their types', () => {
    assert.equal(providerFor('org.gnome.Nautilus.desktop', ['inode/directory']).kind, FOLDERS);
    assert.equal(providerFor('org.gnome.Nautilus.desktop').title, 'Recent Folders');

    const code = providerFor('com.microsoft.VSCode.desktop', ['application/x-code-workspace']);
    assert.equal(code.kind, VSCODE);
    assert.deepEqual(code.configDirs, [{base: 'config', path: 'Code'}]);
    assert.deepEqual(providerFor('codium.desktop').configDirs, [{base: 'config', path: 'VSCodium'}]);
    assert.deepEqual(providerFor('com.visualstudio.code.desktop').configDirs,
        [{base: 'home', path: '.var/app/com.visualstudio.code/config/Code'}]);

    const viewer = providerFor('org.gnome.Loupe.desktop', ['image/png', 'image/jpeg']);
    assert.deepEqual(viewer, {kind: FILES, title: 'Recent Files', types: ['image/png', 'image/jpeg']});
});

test('Text Editor gets its own types, apps without types get no list, folders are no file type', () => {
    assert.deepEqual(providerFor('org.gnome.TextEditor.desktop', ['text/plain', 'application/x-zerosize']),
        {kind: FILES, title: 'Recent Files', types: ['text/plain', 'application/x-zerosize']});
    assert.equal(providerFor('org.gnome.Calculator.desktop', []), null);
    assert.equal(providerFor('org.gnome.Calculator.desktop'), null);
    assert.equal(providerFor('some.Browser.desktop', ['inode/directory']), null);
});

test('VS Code recents: folders and workspaces, local only, in order', () => {
    const json = JSON.stringify({
        entries: [
            {folderUri: 'file:///w/kagaz'},
            {workspace: {id: 'abc', configPath: 'file:///w/team.code-workspace'}},
            {fileUri: 'file:///w/notes.md'},
            {folderUri: 'vscode-remote://ssh-remote%2Bbox/home/u/x', remoteAuthority: 'ssh-remote+box'},
            {folderUri: 'file:///w/kagaz'},
            {label: 'odd entry'},
            null,
            {folderUri: 'file:///w/My%20Project'},
        ],
    });
    assert.deepEqual(vscodeRecents(json),
        ['file:///w/kagaz', 'file:///w/team.code-workspace', 'file:///w/My%20Project']);
});

test('VS Code recents survive missing or broken data', () => {
    assert.deepEqual(vscodeRecents(''), []);
    assert.deepEqual(vscodeRecents('not json'), []);
    assert.deepEqual(vscodeRecents('null'), []);
    assert.deepEqual(vscodeRecents('{"entries": 5}'), []);
});

test('VS Code open windows: the last active first, then the others', () => {
    const json = JSON.stringify({
        theme: 'vs-dark',
        windowsState: {
            lastActiveWindow: {folder: 'file:///w/b', backupPath: '/x', uiState: {}},
            openedWindows: [
                {folder: 'file:///w/a'},
                {folder: 'file:///w/b'},
                {workspaceIdentifier: {id: 'x', configURIPath: 'file:///w/c.code-workspace'}},
                {backupPath: '/empty-window'},
            ],
        },
    });
    assert.deepEqual(vscodeWindows(json), ['file:///w/b', 'file:///w/a', 'file:///w/c.code-workspace']);
    assert.deepEqual(vscodeWindows('{}'), []);
    assert.deepEqual(vscodeWindows('{"windowsState": {}}'), []);
    assert.deepEqual(vscodeWindows('broken'), []);
});

test('VS Code open windows of older versions: folderUri, folderPath and configPath', () => {
    const json = JSON.stringify({
        windowsState: {
            lastActiveWindow: {folderPath: '/w/my project'},
            openedWindows: [{folderUri: 'file:///w/a'}, {workspace: {id: 'x', configPath: '/w/c.code-workspace'}}],
        },
    });
    assert.deepEqual(vscodeWindows(json), ['file:///w/my%20project', 'file:///w/a', 'file:///w/c.code-workspace']);
});

test('VS Code workspaceStorage: folders and workspaces by last use, newest first', () => {
    const items = [
        {json: '{"folder": "file:///w/old"}', time: 100},
        {json: '{"folder": "file:///w/newest"}', time: 300},
        {json: '{"workspace": "file:///w/team.code-workspace"}', time: 200},
        {json: '{"folder": "vscode-remote://ssh-remote%2Bbox/home/u/x"}', time: 400},
        {json: '{"folder": "file:///w/old"}', time: 50},
        {json: 'broken', time: 500},
        {json: '{}', time: 600},
    ];
    assert.deepEqual(vscodeWorkspaces(items),
        ['file:///w/newest', 'file:///w/team.code-workspace', 'file:///w/old']);
    assert.deepEqual(vscodeWorkspaces([]), []);
});

test('VS Code before history.recentlyOpenedPathsList: storage.json openedPathsList', () => {
    const json = JSON.stringify({
        openedPathsList: {
            workspaces3: ['file:///w/a', {id: 'x', configURIPath: 'file:///w/b.code-workspace'}, 'vscode-remote://x/y'],
            workspaces2: ['/w/old path', {id: 'y', configPath: '/w/c.code-workspace'}],
            workspaces: ['/w/oldest', '/w/a'],
            files2: ['/w/file.txt'],
        },
    });
    assert.deepEqual(vscodeOpenedPaths(json), [
        'file:///w/a', 'file:///w/b.code-workspace', 'file:///w/old%20path',
        'file:///w/c.code-workspace', 'file:///w/oldest',
    ]);
    assert.deepEqual(vscodeOpenedPaths('{}'), []);
    assert.deepEqual(vscodeOpenedPaths('{"openedPathsList": {"workspaces3": 5}}'), []);
    assert.deepEqual(vscodeOpenedPaths('broken'), []);
});

test('the new window action is new-window, else new-empty-window', () => {
    assert.equal(newWindowAction(['new-window', 'new-private-window']), 'new-window');
    assert.equal(newWindowAction(['new-empty-window']), 'new-empty-window');
    assert.equal(newWindowAction(['quit']), null);
    assert.equal(newWindowAction([]), null);
});

test('a command line gets the file in place of its field code, or at the end', () => {
    const file = {path: '/w/My Folder', uri: 'file:///w/My%20Folder'};
    assert.deepEqual(commandForFile(['/usr/share/code/code', '--new-window', '%F'], file),
        ['/usr/share/code/code', '--new-window', '/w/My Folder']);
    assert.deepEqual(commandForFile(['nautilus', '--new-window'], file),
        ['nautilus', '--new-window', '/w/My Folder']);
    assert.deepEqual(commandForFile(['app', '%U', '%i', '%c'], file), ['app', 'file:///w/My%20Folder']);
    assert.deepEqual(commandForFile(['flatpak', 'run', '--file-forwarding', 'org.x', '@@u', '%U', '@@'], file),
        ['flatpak', 'run', '--file-forwarding', 'org.x', '@@u', 'file:///w/My%20Folder', '@@']);
    assert.deepEqual(commandForFile(['app', '--rate=100%%'], file), ['app', '--rate=100%', '/w/My Folder']);
});
