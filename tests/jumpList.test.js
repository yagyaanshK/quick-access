import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
    countEntries, entryLabels, entryName, firstFound, listFor, opensType, pin, recentCandidates,
    recentFiles, removeEntry, unpin,
} from '../src/jumpList.js';

// A tiny stand-in for the shared MIME database: subclass -> parents.
const PARENTS = {
    'text/x-python': ['text/plain'],
    'application/x-shellscript': ['text/plain'],
    'text/plain': ['application/octet-stream'],
    'image/png': ['application/octet-stream'],
    'image/jpeg': ['application/octet-stream'],
};
function isA(mime, type) {
    if (mime === type)
        return true;
    return (PARENTS[mime] ?? []).some(parent => isA(parent, type));
}

test('a type matches itself and its subclasses', () => {
    assert.equal(opensType('text/plain', ['text/plain'], isA), true);
    assert.equal(opensType('text/x-python', ['text/plain'], isA), true);
    assert.equal(opensType('image/png', ['text/plain'], isA), false);
    assert.equal(opensType('image/png', ['image/jpeg', 'image/png'], isA), true);
});

test('catch-all types match only exactly, folders and unknown types never', () => {
    assert.equal(opensType('image/png', ['application/octet-stream'], isA), false);
    assert.equal(opensType('application/octet-stream', ['application/octet-stream'], isA), true);
    assert.equal(opensType('inode/directory', ['inode/directory'], isA), false);
    assert.equal(opensType(null, ['text/plain'], isA), false);
});

test('recent files: matching local ones, newest first, without system places', () => {
    const entries = [
        {uri: 'file:///w/a.txt', mime: 'text/plain', time: 10},
        {uri: 'file:///w/b.py', mime: 'text/x-python', time: 30},
        {uri: 'file:///w/c.png', mime: 'image/png', time: 40},
        {uri: 'file:///tmp/d.txt', mime: 'text/plain', time: 50},
        {uri: 'file:///run/user/1000/doc/x/e.txt', mime: 'text/plain', time: 60},
        {uri: 'sftp://host/f.txt', mime: 'text/plain', time: 70},
        {uri: 'file:///w/dir', mime: 'inode/directory', time: 80},
        {uri: 'file:///w/g.sh', mime: 'application/x-shellscript', time: 20},
    ];
    assert.deepEqual(recentFiles(entries, ['text/plain'], isA),
        ['file:///w/b.py', 'file:///w/g.sh', 'file:///w/a.txt']);
    assert.deepEqual(recentFiles(entries, ['image/png'], isA), ['file:///w/c.png']);
    assert.deepEqual(recentFiles(entries, [], isA), []);
});

test('the MIME database is asked once per type, not once per file', () => {
    let calls = 0;
    const counting = (mime, type) => {
        calls++;
        return isA(mime, type);
    };
    const entries = Array.from({length: 50}, (_, i) =>
        ({uri: `file:///w/${i}.txt`, mime: 'text/x-python', time: i}));
    assert.equal(recentFiles(entries, ['image/png', 'text/plain'], counting).length, 50);
    assert.equal(calls, 2);
});

test('candidates leave out pinned and removed entries and duplicates', () => {
    assert.deepEqual(recentCandidates(['a', 'b', 'c', 'b', 'd'], {pinned: ['c'], removed: ['a']}),
        ['b', 'd']);
    assert.deepEqual(recentCandidates(['a'], {}), ['a']);
});

test('the first found entries keep their order and stop at the count', async () => {
    const asked = [];
    const lookup = async item => {
        asked.push(item);
        return item.startsWith('gone') ? null : {uri: item};
    };
    const items = ['a', 'gone1', 'b', 'gone2', 'gone3', 'c', 'd', 'e', 'f', 'g'];
    assert.deepEqual((await firstFound(items, 3, lookup)).map(r => r.uri), ['a', 'b', 'c']);
    assert.deepEqual(asked, ['a', 'gone1', 'b', 'gone2', 'gone3', 'c']);
    assert.deepEqual(await firstFound([], 3, lookup), []);
    assert.deepEqual(await firstFound(items, 0, lookup), []);
});

test('names are the decoded last part; workspaces lose their extension', () => {
    assert.equal(entryName('file:///w/My%20Photos'), 'My Photos');
    assert.equal(entryName('file:///w/notes.txt'), 'notes.txt');
    assert.equal(entryName('file:///w/kagaz.code-workspace'), 'kagaz');
    assert.equal(entryName('file:///w/dir/'), 'dir');
    assert.equal(entryName('file:///'), '/');
});

test('labels have no detail unless names clash', () => {
    assert.deepEqual(entryLabels(['file:///w/a', 'file:///w/b']),
        [{name: 'a', detail: ''}, {name: 'b', detail: ''}]);
});

test('clashing names get the shortest parent path that tells them apart', () => {
    const home = '/home/u';
    assert.deepEqual(entryLabels([
        'file:///run/media/u/Shared/ubuntu/projects',
        'file:///home/u/projects',
        'file:///home/u/Pictures/Screenshots',
        'file:///home/u/work/screenshots',
    ], home), [
        {name: 'projects', detail: 'ubuntu'},
        {name: 'projects', detail: '~'},
        {name: 'Screenshots', detail: 'Pictures'},
        {name: 'screenshots', detail: 'work'},
    ]);
    assert.deepEqual(entryLabels(['file:///a/x/shots', 'file:///b/x/shots', 'file:///c/y/shots'], home), [
        {name: 'shots', detail: 'a/x'},
        {name: 'shots', detail: 'b/x'},
        {name: 'shots', detail: 'c/y'},
    ]);
    assert.deepEqual(entryLabels(['file:///notes', 'file:///w/notes'], home), [
        {name: 'notes', detail: '/'},
        {name: 'notes', detail: 'w'},
    ]);
});

test('pins keep their order, without duplicates, per app', () => {
    let pins = {};
    pins = pin(pins, 'files', 'file:///a');
    pins = pin(pins, 'files', 'file:///b');
    pins = pin(pins, 'files', 'file:///a');
    pins = pin(pins, 'code', 'file:///a');
    assert.deepEqual(pins, {files: ['file:///a', 'file:///b'], code: ['file:///a']});
    pins = unpin(pins, 'code', 'file:///a');
    assert.deepEqual(pins, {files: ['file:///a', 'file:///b']});
    assert.deepEqual(listFor(pins, 'code'), []);
    assert.deepEqual(listFor(null, 'code'), []);
});

test('pinning does not change the object it was given', () => {
    const pins = {files: ['file:///a']};
    pin(pins, 'files', 'file:///b');
    unpin(pins, 'files', 'file:///a');
    assert.deepEqual(pins, {files: ['file:///a']});
});

test('removing a pinned entry unpins it; removing a recent one hides it', () => {
    const state = {pins: {files: ['file:///p']}, removed: {}};
    assert.deepEqual(removeEntry(state, 'files', 'file:///p'), {pins: {}, removed: {}});
    assert.deepEqual(removeEntry(state, 'files', 'file:///r'),
        {pins: {files: ['file:///p']}, removed: {files: ['file:///r']}});
    const again = removeEntry({pins: {}, removed: {files: ['file:///a', 'file:///b']}}, 'files', 'file:///b');
    assert.deepEqual(again.removed, {files: ['file:///b', 'file:///a']});
});

test('removed entries are capped per app, newest kept', () => {
    let state = {pins: {}, removed: {}};
    for (let i = 0; i < 120; i++)
        state = removeEntry(state, 'files', `file:///${i}`);
    assert.equal(state.removed.files.length, 100);
    assert.equal(state.removed.files[0], 'file:///119');
});

test('entries are counted across apps', () => {
    assert.equal(countEntries({a: ['x', 'y'], b: ['z']}), 3);
    assert.equal(countEntries({}), 0);
    assert.equal(countEntries(null), 0);
});
