#!/bin/bash
# End-to-end test of the dock jump lists in a throwaway headless GNOME Shell
# with Ubuntu Dock. Config, data, dconf and the test folders are temporary,
# so the real recent files, VS Code history and settings are never touched.
# Apps are "launched" through a stand-in app that only records what it got.
#
#   tests/jumplists.sh                 (needs gnome-shell, ubuntu-dock, gdbus, python3)
#   SHOTS=/some/dir tests/jumplists.sh (also saves screenshots of open jump lists)
set -u
SRC="$(cd "$(dirname "$0")/.." && pwd)"
UUID=quick-access@yagyaanshK.github.com
DOCK=ubuntu-dock@ubuntu.com
NAME=gnome-shell-qa-jumplists           # process name, so only this shell is stopped
R=$(mktemp -d /tmp/qajl-XXXXXX)         # short path: the Wayland socket lives under it
# Test folders can't be under /tmp: Quick Access skips system folders there.
W="$SRC/tests/scratch/jumplists"; rm -rf "$W"
cleanup() {
    pkill -f "^$NAME" 2>/dev/null; timeout 2 tail -f /dev/null
    for m in $(awk -v r="$R" 'index($2, r) == 1 {print $2}' /proc/mounts); do fusermount3 -uz "$m" 2>/dev/null; done
    [ -n "${KEEP:-}" ] && { echo "kept $R"; return; }
    rm -rf "$R" "$W"; rmdir "$SRC/tests/scratch" 2>/dev/null
}
trap cleanup EXIT

[ -d "/usr/share/gnome-shell/extensions/$DOCK" ] || { echo "SKIP  $DOCK is not installed"; exit 0; }

export XDG_RUNTIME_DIR=$R/run XDG_CONFIG_HOME=$R/config XDG_DATA_HOME=$R/data XDG_CACHE_HOME=$R/cache XDG_STATE_HOME=$R/state
mkdir -p $XDG_RUNTIME_DIR $XDG_CONFIG_HOME $XDG_DATA_HOME/gnome-shell/extensions $XDG_DATA_HOME/applications
chmod 700 $XDG_RUNTIME_DIR
echo "user-db:qajumplists" > $R/dconf-profile; export DCONF_PROFILE=$R/dconf-profile
EXT=$XDG_DATA_HOME/gnome-shell/extensions/$UUID
rsync -a --exclude .git --exclude tests --exclude '*.md' --exclude '*.zip' "$SRC/" "$EXT/"
glib-compile-schemas "$EXT/schemas"

# Folders and files. "projects" twice, to check that clashing names get told apart.
mkdir -p "$W/projects/006_kagaz" "$W/projects/010_workout" "$W/Shared/ubuntu/projects" "$W/docs" "$W/My Photos" "$W/.hidden" "$W/open" $R/tmpdir
echo x > "$W/projects/006_kagaz/main.c"; echo x > "$W/docs/notes.txt"; echo x > "$W/docs/tool.py"
echo x > "$W/My Photos/a.jpg"; echo x > "$W/.hidden/secret.txt"; echo x > $R/tmpdir/scratch.txt

# A stand-in app for text files that writes down how it was started.
cat > $R/recorder <<EOF
#!/bin/sh
echo "\$*" >> $R/launches
EOF
chmod +x $R/recorder
cat > $XDG_DATA_HOME/applications/qa-recorder.desktop <<EOF
[Desktop Entry]
Type=Application
Name=QA Recorder
Exec=$R/recorder open %F
Icon=text-editor
MimeType=text/plain;
Actions=new-window;

[Desktop Action new-window]
Name=New Window
Exec=$R/recorder new
EOF
# And one for images, not in the dock, for the app grid's own menus.
cat > $XDG_DATA_HOME/applications/qa-viewer.desktop <<EOF
[Desktop Entry]
Type=Application
Name=QA Viewer
Exec=$R/recorder view %U
Icon=image-viewer
MimeType=image/jpeg;
EOF

# recently-used.xbel with one entry per "path:mime:seconds-ago", recorded by
# the file chooser portal as on a real system.
xbel() {
    python3 - "$XDG_DATA_HOME/recently-used.xbel" "$@" <<'PY'
import sys, pathlib, datetime
out, now = sys.argv[1], datetime.datetime.now(datetime.timezone.utc)
rows = []
for spec in sys.argv[2:]:
    path, mime, ago = spec.rsplit(':', 2)
    t = (now - datetime.timedelta(seconds=int(ago))).strftime('%Y-%m-%dT%H:%M:%S.000000Z')
    rows.append(f'''  <bookmark href="{pathlib.Path(path).as_uri()}" added="{t}" modified="{t}" visited="{t}">
    <info><metadata owner="http://freedesktop.org"><mime:mime-type type="{mime}"/>
      <bookmark:applications><bookmark:application name="xdg-desktop-portal-gnome" exec="x" modified="{t}" count="1"/></bookmark:applications>
    </metadata></info>
  </bookmark>''')
pathlib.Path(out).write_text('<?xml version="1.0" encoding="UTF-8"?>\n<xbel version="1.0" '
    'xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" '
    'xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info">\n' + '\n'.join(rows) + '\n</xbel>\n')
PY
}
xbel "$W/projects/006_kagaz/main.c:text/x-csrc:5" "$W/docs/notes.txt:text/plain:10" "$W/docs/tool.py:text/x-python:20" \
     "$W/My Photos/a.jpg:image/jpeg:30" "$W/projects:inode/directory:40" "$W/Shared/ubuntu/projects:inode/directory:50" \
     "$W/.hidden/secret.txt:text/plain:3" "$R/tmpdir/scratch.txt:text/plain:2" "$W/gone/old.txt:text/plain:1"
XBEL_SUM=$(md5sum < $XDG_DATA_HOME/recently-used.xbel)

# VS Code's state database and storage.json, as VS Code writes them.
G=$XDG_CONFIG_HOME/Code/User/globalStorage; mkdir -p $G
python3 -I - "$G" "$W" <<'PY'
import json, os, pathlib, sqlite3, sys
G, W = sys.argv[1], pathlib.Path(sys.argv[2])
db = sqlite3.connect(f'{G}/state.vscdb')
db.execute('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
entries = [{'folderUri': (W / 'projects/006_kagaz').as_uri()},
           {'fileUri': (W / 'docs/notes.txt').as_uri()},
           {'folderUri': 'vscode-remote://ssh-remote%2Bbox/home/u/remote'},
           {'folderUri': (W / 'projects').as_uri()},
           {'folderUri': (W / 'deleted').as_uri()},
           {'folderUri': (W / 'Shared/ubuntu/projects').as_uri()}]
db.execute('INSERT INTO ItemTable VALUES (?, ?)', ('history.recentlyOpenedPathsList', json.dumps({'entries': entries})))
db.commit()
state = {'lastActiveWindow': {'folder': (W / 'open').as_uri()}, 'openedWindows': [{'folder': (W / 'projects').as_uri()}]}
pathlib.Path(G, 'storage.json').write_text(json.dumps({'windowsState': state}))

# workspaceStorage: one folder per workspace VS Code has opened, its last use
# being the time of the state.vscdb inside. Current versions keep no other list.
(W / 'team.code-workspace').write_text('{"folders": []}')
for n, (workspace, ago) in enumerate([({'folder': (W / 'projects/010_workout').as_uri()}, 10),
                                      ({'folder': (W / 'projects/006_kagaz').as_uri()}, 20),
                                      ({'workspace': (W / 'team.code-workspace').as_uri()}, 30),
                                      ({'folder': 'vscode-remote://ssh-remote%2Bbox/home/u/remote'}, 5),
                                      ({'folder': (W / 'deleted').as_uri()}, 1),
                                      (None, 0)]):
    d = pathlib.Path(G).parent / 'workspaceStorage' / f'ws{n}'
    d.mkdir(parents=True)
    if workspace:
        (d / 'workspace.json').write_text(json.dumps(workspace))
    (d / 'state.vscdb').write_bytes(b'')
    t = 2_000_000_000 - ago * 60
    os.utime(d / 'state.vscdb', (t, t))
PY

dbus-run-session -- bash -c "echo \$DBUS_SESSION_BUS_ADDRESS > $R/bus
    gsettings set org.gnome.shell enabled-extensions \"['$DOCK', '$UUID']\"
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
    gsettings set org.gnome.shell favorite-apps \"['org.gnome.Nautilus.desktop', 'com.microsoft.VSCode.desktop', 'org.gnome.TextEditor.desktop', 'qa-recorder.desktop']\"
    exec -a '$NAME' gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --unsafe-mode" \
    > $R/shell.log 2>&1 &

ev() { gdbus call --address "$(cat $R/bus 2>/dev/null)" -d org.gnome.Shell -o /org/gnome/Shell \
    -m org.gnome.Shell.Eval "$1" 2>/dev/null; }
# The value of a JS expression: strings as they are, anything else as JSON.
val() { ev "$1" | python3 -c '
import ast, json, sys
out = sys.stdin.read().strip()
if out:
    ok, _, text = out[1:-1].partition(", ")
    text = ast.literal_eval(text)
    value = json.loads(text) if ok == "true" and text else text
    print(value if isinstance(value, str) else json.dumps(value), end="")'; }
settle() { timeout "${1:-1}" tail -f /dev/null; }
for i in $(seq 1 40); do
    ev "Main.extensionManager._extensions.get('$UUID')?.state === 1 && !!Main.extensionManager._extensions.get('$DOCK')?.stateObj" | grep -q "true, 'true'" && break
    settle 1
done
settle 2

# Helpers inside the shell: find dock icons, describe a menu, place the pointer.
ev "$(cat <<'JS'
globalThis.__qa = {
    find(test) {
        let found = null;
        const walk = a => {
            if (!found && test(a))
                found = a;
            for (const c of a.get_children())
                walk(c);
        };
        walk(global.stage);
        return found;
    },
    icon(id) {
        return this.find(a => a.constructor.name === 'DockAppIcon' && a.app?.get_id() === id);
    },
    open(id) {
        const icon = this.icon(id);
        if (!icon._menu?.isOpen)
            icon.popupMenu();
        return 'opened';
    },
    close(id) {
        this.icon(id)?._menu?.close();
        return 'closed';
    },
    menu(id) {
        return this.icon(id)._menu;
    },
    // Visible items: "# heading", rows as "name" or "name (detail)", "---" for a separator.
    describe(id) {
        return this.describeMenu(this.menu(id));
    },
    describeMenu(menu) {
        const out = [];
        const walk = box => {
            for (const c of box.get_children()) {
                const d = c._delegate;
                if (!c.visible || !d)
                    continue;
                if (d.box && !d.label)
                    walk(d.box);
                else if (d.entry)
                    out.push(d.label.text + c.get_children().filter(x => x.style_class === 'quick-access-jump-detail').map(x => ` (${x.text.slice(2)})`).join(''));
                else if (d.constructor.name.includes('Separator'))
                    out.push(d.label.text ? `# ${d.label.text}` : '---');
                else if (d.label)
                    out.push(d.label.text);
            }
        };
        walk(menu.box);
        return out.join('|');
    },
    rows(id) {
        const out = [];
        const walk = a => {
            if (a.entry)
                out.push(a);
            for (const c of a.get_children())
                walk(c);
        };
        walk(this.menu(id).box);
        return out;
    },
    row(id, name) {
        return this.rows(id).find(r => r.label.text === name);
    },
    pointer() {
        const C = imports.gi.Clutter;
        this._pointer ??= C.get_default_backend().get_default_seat().create_virtual_device(C.InputDeviceType.POINTER_DEVICE);
        return this._pointer;
    },
    moveTo(actor, dx = 0) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        this.pointer().notify_absolute_motion(imports.gi.GLib.get_monotonic_time(), x + w / 2 + dx, y + h / 2);
        return 'moved';
    },
    click(button = 1) {
        const C = imports.gi.Clutter, t = imports.gi.GLib.get_monotonic_time();
        this.pointer().notify_button(t, button, C.ButtonState.PRESSED);
        this.pointer().notify_button(t + 1000, button, C.ButtonState.RELEASED);
        return 'clicked';
    },
    tooltip() {
        const t = Main.uiGroup.get_children().find(c => c.has_style_class_name?.('quick-access-jump-tooltip'));
        return t?.visible && t.opacity > 0 ? t.text : '';
    },
    settings() {
        return Main.extensionManager._extensions.get('quick-access@yagyaanshK.github.com').stateObj.getSettings();
    },
    leftovers() {
        let n = 0;
        const walk = a => {
            if (a.has_style_class_name?.('quick-access-jump-list') || a.has_style_class_name?.('quick-access-jump-tooltip') || a.entry)
                n++;
            for (const c of a.get_children())
                walk(c);
        };
        walk(global.stage);
        return n;
    },
};
'helpers'
JS
)" >/dev/null

fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; [ $# -gt 1 ] && echo "      $2"; fails=$((fails+1)); }
check() { # name, expected, got
    if [ "$2" = "$3" ]; then pass "$1"; else fail "$1"; echo "      want: $2"; echo "      got:  $3"; fi
}
# The top of an app's menu, down to its own "New Window" item: the dock's
# title and the jump list. (What follows can include Files' own bookmark
# list, which Ubuntu Dock shows once Files runs.)
top() { local d; d=$(val "__qa.describe('$1')"); echo "${d%%|New Window*}"; }
menu() { # app id -> top of its menu, opened
    val "__qa.open('$1')" >/dev/null; settle 1
    top "$1"
}
shot() { # file name
    [ -n "${SHOTS:-}" ] || return 0
    mkdir -p "$SHOTS"; rm -f "$SHOTS/$1"
    ev "new imports.gi.Shell.Screenshot().screenshot(false, imports.gi.Gio.File.new_for_path('$SHOTS/$1').replace(null, false, 0, null), null)" >/dev/null
    settle 1
}
FILES=org.gnome.Nautilus.desktop CODE=com.microsoft.VSCode.desktop TEXT=org.gnome.TextEditor.desktop REC=qa-recorder.desktop
PROJECTS="projects (jumplists)|projects (ubuntu)"

check "only Ubuntu Dock and Quick Access are enabled (no other dock menu extension)" \
    "$UUID,$DOCK" "$(val "[...Main.extensionManager._extensions.values()].filter(e => e.state === 1).map(e => e.uuid).sort().join(',')")"

check "Files: recent folders, newest first; hidden, /tmp and missing ones skipped; clashing names told apart" \
    "# Files|# Recent Folders|006_kagaz|docs|My Photos|$PROJECTS|---" "$(menu $FILES)"
shot jumplist-files.png
val "__qa.close('$FILES')" >/dev/null

check "VS Code: its recent list, then its workspaces by last use, then its open windows; files, remote and deleted folders skipped" \
    "# Visual Studio Code|# Recent Folders|006_kagaz|$PROJECTS|010_workout|team|open|---" "$(menu $CODE)"
shot jumplist-vscode.png
val "__qa.close('$CODE')" >/dev/null

python3 -I - "$G/state.vscdb" "$W" <<'PY'
import json, pathlib, sqlite3, sys
db, W = sqlite3.connect(sys.argv[1]), pathlib.Path(sys.argv[2])
key = 'history.recentlyOpenedPathsList'
value = json.loads(db.execute('SELECT value FROM ItemTable WHERE key = ?', (key,)).fetchone()[0])
value['entries'].insert(0, {'folderUri': (W / 'docs').as_uri()})
db.execute('INSERT INTO ItemTable VALUES (?, ?)', (key, json.dumps(value)))
db.commit()
PY
check "a change to VS Code's history shows the next time its menu opens" \
    "# Visual Studio Code|# Recent Folders|docs|006_kagaz|$PROJECTS|010_workout|team|open|---" "$(menu $CODE)"
val "__qa.close('$CODE')" >/dev/null

python3 -I - "$G/state.vscdb" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("DELETE FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'")
db.commit()
PY
check "current VS Code without a recent list: its workspaces by last use, then its open windows" \
    "# Visual Studio Code|# Recent Folders|010_workout|006_kagaz|team|open|projects|---" "$(menu $CODE)"
val "__qa.close('$CODE')" >/dev/null

check "Text Editor: recent text files of any text type, hidden ones too; no images, /tmp or missing files" \
    "# Text Editor|# Recent Files|secret.txt|main.c|notes.txt|tool.py|---" "$(menu $TEXT)"
val "__qa.close('$TEXT')" >/dev/null

check "any other app: recent files of the types its desktop file lists" \
    "# QA Recorder|# Recent Files|secret.txt|main.c|notes.txt|tool.py|---" "$(menu $REC)"
val "__qa.close('$REC')" >/dev/null

val "__qa.settings().set_int('jump-list-items', 2)" >/dev/null
check "the number of recent entries follows the setting" \
    "# Files|# Recent Folders|006_kagaz|docs|---" "$(menu $FILES)"
val "__qa.close('$FILES')" >/dev/null
val "__qa.settings().reset('jump-list-items')" >/dev/null

# Hover: buttons and tooltip.
menu $FILES >/dev/null
check "buttons are hidden on rows that are not hovered" "0,false" "$(val "[__qa.row('$FILES', 'docs')._buttons.opacity, __qa.row('$FILES', 'docs').pinButton.reactive].join()")"
val "__qa.moveTo(__qa.row('$FILES', 'docs'), -60)" >/dev/null; settle 1.5
check "hovering a row shows its buttons" "255,true" "$(val "[__qa.row('$FILES', 'docs')._buttons.opacity, __qa.row('$FILES', 'docs').pinButton.reactive].join()")"
check "hovering a row shows its full path as a tooltip" "$W/docs" "$(val "__qa.tooltip()")"
shot jumplist-files-hover.png

# Pinning with the button keeps the menu open and redraws it in place.
val "__qa.moveTo(__qa.row('$FILES', 'docs').pinButton)" >/dev/null; settle 0.5
val "__qa.click()" >/dev/null; settle 1
check "the pin button pins without closing the menu" \
    "true|# Files|# Pinned|docs|# Recent Folders|006_kagaz|My Photos|$PROJECTS|---" \
    "$(val "__qa.menu('$FILES').isOpen")|$(top $FILES)"
val "__qa.moveTo(__qa.row('$FILES', 'My Photos'), -60)" >/dev/null; settle 0.5
val "__qa.moveTo(__qa.row('$FILES', 'My Photos').pinButton)" >/dev/null; settle 0.5
val "__qa.click()" >/dev/null; settle 1
check "pins stay in the order they were pinned" \
    "# Files|# Pinned|docs|My Photos|# Recent Folders|006_kagaz|$PROJECTS|---" "$(top $FILES)"
check "pins are stored per app" "{'$FILES': ['$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).as_uri())' "$W/docs")', '$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).as_uri())' "$W/My Photos")']}" \
    "$(val "__qa.settings().get_value('jump-list-pins').print(false)")"
shot jumplist-files-pinned.png

val "__qa.moveTo(__qa.row('$FILES', 'docs'), -60)" >/dev/null; settle 0.5
val "__qa.moveTo(__qa.row('$FILES', 'docs').pinButton)" >/dev/null; settle 0.5
val "__qa.click()" >/dev/null; settle 1
check "the pin button on a pinned row unpins it" \
    "# Files|# Pinned|My Photos|# Recent Folders|006_kagaz|docs|$PROJECTS|---" "$(top $FILES)"

# Removing.
val "__qa.moveTo(__qa.row('$FILES', '006_kagaz'), -60)" >/dev/null; settle 0.5
val "__qa.moveTo(__qa.row('$FILES', '006_kagaz').removeButton)" >/dev/null; settle 0.5
val "__qa.click()" >/dev/null; settle 1
check "the remove button takes an entry off the list without closing the menu" \
    "true|# Files|# Pinned|My Photos|# Recent Folders|docs|$PROJECTS|---" \
    "$(val "__qa.menu('$FILES').isOpen")|$(top $FILES)"
val "__qa.moveTo(__qa.row('$FILES', 'My Photos'), -60)" >/dev/null; settle 0.5
val "__qa.moveTo(__qa.row('$FILES', 'My Photos').removeButton)" >/dev/null; settle 0.5
val "__qa.click()" >/dev/null; settle 1
check "removing a pinned entry only unpins it" \
    "# Files|# Recent Folders|docs|My Photos|$PROJECTS|---" "$(top $FILES)"
[ -d "$W/projects/006_kagaz" ] && [ "$(md5sum < $XDG_DATA_HOME/recently-used.xbel)" = "$XBEL_SUM" ] \
    && pass "removing deletes no file and leaves recently-used.xbel alone" || fail "removing touched files"
val "__qa.close('$FILES')" >/dev/null
check "a removed entry stays removed for that app only" \
    "yes" "$(menu $CODE | grep -q '|006_kagaz|' && echo yes)"
val "__qa.close('$CODE')" >/dev/null

# Opening entries, through the stand-in app.
menu $REC >/dev/null
val "__qa.moveTo(__qa.row('$REC', 'notes.txt'), -60)" >/dev/null; settle 0.5
val "__qa.click()" >/dev/null; settle 1.5
check "clicking an entry opens it with the app and closes the menu" \
    "false|open $W/docs/notes.txt" "$(val "__qa.menu('$REC').isOpen")|$(tail -1 $R/launches 2>/dev/null)"
menu $REC >/dev/null
val "__qa.moveTo(__qa.row('$REC', 'tool.py'), -60)" >/dev/null; settle 0.5
val "__qa.click(2)" >/dev/null; settle 1.5
check "middle-clicking an entry opens it with the app's new window action" \
    "new $W/docs/tool.py" "$(tail -1 $R/launches 2>/dev/null)"
check "the new window command of VS Code" '/usr/share/code/code,--new-window,/w/a b' \
    "$(val "Main.extensionManager._extensions.get('$UUID').stateObj._jumpLists._newWindowCommand(imports.gi.Shell.AppSystem.get_default().lookup_app('$CODE').get_app_info(), {path: '/w/a b', uri: 'file:///w/a%20b'})?.join()")"

# GNOME's own app menu (app grid) gets the list too.
ev "Main.overview.showApps()" >/dev/null; settle 2
val "(() => { __qa.grid = __qa.find(a => a.constructor.name === 'AppIcon' && a.app?.get_id() === 'qa-viewer.desktop'); __qa.grid.popupMenu(); return 'opened'; })()" >/dev/null; settle 1
check "the app grid's own menus get a jump list as well" "# Recent Files|a.jpg|---" \
    "$(val "__qa.describeMenu(__qa.grid._menu)" | cut -d'|' -f1-3)"
shot jumplist-app-grid.png
val "__qa.grid._menu.close()" >/dev/null
ev "Main.overview.hide()" >/dev/null; settle 1.5

mkdir -p "$W/new folder"
xbel "$W/new folder:inode/directory:0" "$W/projects/006_kagaz/main.c:text/x-csrc:5" "$W/docs/notes.txt:text/plain:10" \
     "$W/My Photos/a.jpg:image/jpeg:30" "$W/projects:inode/directory:40" "$W/Shared/ubuntu/projects:inode/directory:50"
check "a new recent folder shows the next time the menu opens" \
    "# Files|# Recent Folders|new folder|docs|My Photos|$PROJECTS|---" "$(menu $FILES)"
val "__qa.close('$FILES')" >/dev/null

# Privacy, the on/off switch, disabling.
ev "new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.privacy'}).set_boolean('remember-recent-files', false)" >/dev/null
val "__qa.settings().set_value('jump-list-pins', new imports.gi.GLib.Variant('a{sas}', {'$FILES': ['$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).as_uri())' "$W/docs")']}))" >/dev/null
check "with File History off only the pins are shown" "# Files|# Pinned|docs|---" "$(menu $FILES)"
val "__qa.close('$FILES')" >/dev/null
ev "new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.privacy'}).set_boolean('remember-recent-files', true)" >/dev/null

val "__qa.open('$FILES')" >/dev/null; settle 1
val "__qa.settings().set_boolean('dock-jump-lists', false)" >/dev/null; settle 0.5
check "switching jump lists off removes them, even from an open menu" "0|# Files" \
    "$(val "__qa.leftovers()")|$(top $FILES)"
val "__qa.close('$FILES')" >/dev/null
check "and they are not added any more" "# Files" "$(menu $FILES)"
val "__qa.close('$FILES')" >/dev/null
val "__qa.settings().set_boolean('dock-jump-lists', true)" >/dev/null; settle 0.5
check "switching them back on brings them back" "# Files|# Pinned|docs|# Recent Folders|new folder|My Photos|$PROJECTS|---" "$(menu $FILES)"

ev "Main.extensionManager.disableExtension('$UUID')" >/dev/null; settle 1
check "disabling the extension removes every row, section and tooltip, even from an open menu" "0" "$(val "__qa.leftovers()")"
val "__qa.close('$FILES')" >/dev/null
check "menus are back to the dock's own after disabling" "# Files" "$(menu $FILES)"
val "__qa.close('$FILES')" >/dev/null

if grep -E "JS ERROR|JS WARNING|Quick Access|$UUID" $R/shell.log; then fail "errors in the shell log"; fi
echo; [ $fails = 0 ] && echo "All checks passed" || echo "$fails check(s) failed"
exit $fails
