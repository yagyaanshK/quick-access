import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    MARK, folderUriOf, isManaged, labelsFor, mergeBookmarks, parseBookmarks,
    recentFolders, removedByUser,
} from '../src/recents.js';

test('a file stands for its folder, a folder for itself', () => {
    assert.equal(folderUriOf('file:///home/u/Pictures/a.jpg', false), 'file:///home/u/Pictures');
    assert.equal(folderUriOf('file:///home/u/Pictures', true), 'file:///home/u/Pictures');
    assert.equal(folderUriOf('file:///home/u/Pictures/', true), 'file:///home/u/Pictures');
    assert.equal(folderUriOf('file:///a.txt', false), null);
    assert.equal(folderUriOf('smb://server/share/a.txt', false), null);
    assert.equal(folderUriOf('recent:///abc', false), null);
});

test('folders are ordered by their latest use and capped', () => {
    const entries = [
        {uri: 'file:///w/a/1.jpg', isDir: false, time: 10},
        {uri: 'file:///w/b/1.jpg', isDir: false, time: 30},
        {uri: 'file:///w/a/2.jpg', isDir: false, time: 40},
        {uri: 'file:///w/c', isDir: true, time: 20},
    ];
    assert.deepEqual(recentFolders(entries, {limit: 5}),
        ['file:///w/a', 'file:///w/b', 'file:///w/c']);
    assert.deepEqual(recentFolders(entries, {limit: 2}), ['file:///w/a', 'file:///w/b']);
});

test('hidden, system, excluded and unusable folders are left out', () => {
    const entries = [
        {uri: 'file:///home/u/.cache/x/a.png', isDir: false, time: 9},
        {uri: 'file:///tmp/a.png', isDir: false, time: 8},
        {uri: 'file:///run/user/1000/doc/a.png', isDir: false, time: 7},
        {uri: 'file:///home/u/Downloads/a.png', isDir: false, time: 6},
        {uri: 'file:///gone/a.png', isDir: false, time: 5},
        {uri: 'file:///home/u/Work/a.png', isDir: false, time: 4},
    ];
    assert.deepEqual(recentFolders(entries, {
        limit: 5,
        exclude: new Set(['file:///home/u/Downloads']),
        isUsable: uri => uri !== 'file:///gone',
    }), ['file:///home/u/Work']);
});

test('an unusable folder does not use up a slot', () => {
    const entries = [
        {uri: 'file:///gone/a.png', isDir: false, time: 9},
        {uri: 'file:///w/a/a.png', isDir: false, time: 8},
        {uri: 'file:///w/b/a.png', isDir: false, time: 7},
    ];
    assert.deepEqual(recentFolders(entries, {limit: 2, isUsable: uri => uri !== 'file:///gone'}),
        ['file:///w/a', 'file:///w/b']);
});

test('labels use the decoded name, with the parent when names clash', () => {
    assert.deepEqual(labelsFor(['file:///w/My%20Photos', 'file:///w/a/shots', 'file:///w/b/shots']), [
        `${MARK}My Photos`, `${MARK}shots (a)`, `${MARK}shots (b)`,
    ]);
    assert.deepEqual(labelsFor(['file:///h/Pictures/Screenshots', 'file:///w/event/screenshots']), [
        `${MARK}Screenshots (Pictures)`, `${MARK}screenshots (event)`,
    ]);
});

test('bookmarks parse with and without labels', () => {
    assert.deepEqual(parseBookmarks('file:///a A b\nfile:///c\n\n'), [
        {uri: 'file:///a', label: 'A b', line: 'file:///a A b'},
        {uri: 'file:///c', label: null, line: 'file:///c'},
    ]);
    assert.equal(isManaged({uri: 'x', label: `${MARK}x`}), true);
    assert.equal(isManaged({uri: 'x', label: 'x'}), false);
    assert.equal(isManaged({uri: 'x', label: null}), false);
});

test('merging keeps the user bookmarks in order and replaces the managed ones', () => {
    const before = `file:///d Documents\nfile:///old ${MARK}old\nfile:///e\n`;
    const after = mergeBookmarks(before, [{uri: 'file:///new', label: `${MARK}new`}]);
    assert.equal(after, `file:///d Documents\nfile:///e\nfile:///new ${MARK}new\n`);
    assert.equal(mergeBookmarks(after, [{uri: 'file:///new', label: `${MARK}new`}]), after);
    assert.equal(mergeBookmarks(after, []), 'file:///d Documents\nfile:///e\n');
    assert.equal(mergeBookmarks('', []), '');
});

test('a managed entry the user removed is reported, a renamed one is not', () => {
    const text = `file:///d Documents\nfile:///b pinned\nfile:///c ${MARK}c\n`;
    assert.deepEqual(removedByUser(['file:///a', 'file:///b', 'file:///c'], text), ['file:///a']);
});
