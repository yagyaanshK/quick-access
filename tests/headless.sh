#!/bin/bash
# End-to-end test in a throwaway headless GNOME Shell. Everything lives in a
# temporary folder: config, data, dconf and the test folders, so the real
# bookmarks and recent files are never touched.
#
#   tests/headless.sh            (needs gnome-shell, dbus-run-session, gdbus)
set -u
SRC="$(cd "$(dirname "$0")/.." && pwd)"
UUID=quick-access@yagyaanshK.github.com
R=$(mktemp -d /tmp/qa-XXXXXX)          # short path: the Wayland socket lives under it
# Test folders can't be under /tmp: Quick Access skips system folders there.
W="$SRC/tests/scratch"; rm -rf "$W"
cleanup() {
    pkill -f '^gnome-shell --headless qa-test' 2>/dev/null; timeout 2 tail -f /dev/null
    for m in $(awk -v r="$R" 'index($2, r) == 1 {print $2}' /proc/mounts); do fusermount3 -uz "$m" 2>/dev/null; done
    [ -n "${KEEP:-}" ] && { echo "kept $R"; return; }
    rm -rf "$R" "$W"
}
trap cleanup EXIT

export XDG_RUNTIME_DIR=$R/run XDG_CONFIG_HOME=$R/config XDG_DATA_HOME=$R/data
mkdir -p $XDG_RUNTIME_DIR $XDG_CONFIG_HOME/gtk-3.0 $XDG_DATA_HOME/gnome-shell/extensions
chmod 700 $XDG_RUNTIME_DIR
echo "user-db:qatest" > $R/dconf-profile; export DCONF_PROFILE=$R/dconf-profile
EXT=$XDG_DATA_HOME/gnome-shell/extensions/$UUID
rsync -a --exclude .git --exclude tests --exclude '*.md' "$SRC/" "$EXT/"
glib-compile-schemas "$EXT/schemas"

mkdir -p "$W/docs" "$W/a" "$W/b" "$W/c" "$W/d" "$W/My Photos" "$W/x/shots" "$W/y/shots" "$W/.hidden"
u() { python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).as_uri())' "$1"; }
printf '%s Documents\n' "$(u "$W/docs")" > $XDG_CONFIG_HOME/gtk-3.0/bookmarks

# recently-used.xbel with one entry per "path:seconds-ago[:dir]"
xbel() {
    python3 - "$XDG_DATA_HOME/recently-used.xbel" "$@" <<'PY'
import sys, pathlib, datetime
out, now = sys.argv[1], datetime.datetime.now(datetime.timezone.utc)
rows = []
for spec in sys.argv[2:]:
    path, ago, *kind = spec.rsplit(':', 2) if spec.endswith(':dir') else spec.rsplit(':', 1)
    t = (now - datetime.timedelta(seconds=int(ago))).strftime('%Y-%m-%dT%H:%M:%S.000000Z')
    mime = 'inode/directory' if kind else 'image/jpeg'
    rows.append(f'''  <bookmark href="{pathlib.Path(path).as_uri()}" added="{t}" modified="{t}" visited="{t}">
    <info><metadata owner="http://freedesktop.org"><mime:mime-type type="{mime}"/>
      <bookmark:applications><bookmark:application name="test" exec="test" modified="{t}" count="1"/></bookmark:applications>
    </metadata></info>
  </bookmark>''')
pathlib.Path(out).write_text('<?xml version="1.0" encoding="UTF-8"?>\n<xbel version="1.0" '
    'xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" '
    'xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info">\n' + '\n'.join(rows) + '\n</xbel>\n')
PY
}
xbel "$W/a/1.jpg:50" "$W/b/1.jpg:40" "$W/c:30:dir" "$W/My Photos/1.jpg:20" "$W/.hidden/1.jpg:10" \
     "$W/docs/1.jpg:5" "$W/gone/1.jpg:1"

dbus-run-session -- bash -c "echo \$DBUS_SESSION_BUS_ADDRESS > $R/bus
    gsettings set org.gnome.shell enabled-extensions \"['$UUID']\"
    gsettings set org.gnome.shell disable-user-extensions false
    exec -a 'gnome-shell --headless qa-test' gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --unsafe-mode" \
    > $R/shell.log 2>&1 &

ev() { gdbus call --address "$(cat $R/bus 2>/dev/null)" -d org.gnome.Shell -o /org/gnome/Shell \
    -m org.gnome.Shell.Eval "$1" 2>/dev/null; }
settle() { timeout "${1:-1.5}" tail -f /dev/null; }
for i in $(seq 1 40); do
    ev "Main.extensionManager._extensions.get('$UUID')?.state === 1" | grep -q "true, 'true'" && break
    settle 1
done
setting() { ev "Main.extensionManager._extensions.get('$UUID').stateObj.getSettings().$1"; }

fails=0
managed() { grep -F $'\U0001F558' $XDG_CONFIG_HOME/gtk-3.0/bookmarks | sed "s#file://$(u "$W" | sed 's#file://##')/##" | tr '\n' '|'; }
check() { # name, expected managed list
    local got; got=$(managed)
    if [ "$got" = "$2" ]; then echo "PASS  $1"; else echo "FAIL  $1"; echo "      want: $2"; echo "      got:  $got"; fails=$((fails+1)); fi
}
M=$'\U0001F558 '

settle 2
check "recent folders, newest first; docs (bookmarked), hidden and missing skipped" \
    "My%20Photos ${M}My Photos|c ${M}c|b ${M}b|a ${M}a|"
grep -q "Documents" $XDG_CONFIG_HOME/gtk-3.0/bookmarks && echo "PASS  own bookmark kept" || { echo "FAIL  own bookmark lost"; fails=$((fails+1)); }

xbel "$W/a/1.jpg:50" "$W/b/1.jpg:40" "$W/c:30:dir" "$W/My Photos/1.jpg:20" "$W/d/new.jpg:0" \
     "$W/x/shots/1.jpg:3" "$W/y/shots/1.jpg:2"
settle 2
check "a new save moves its folder to the top; same names get their parent" \
    "d ${M}d|y/shots ${M}shots (y)|x/shots ${M}shots (x)|My%20Photos ${M}My Photos|c ${M}c|"

sed -i "/${M}c\$/d" $XDG_CONFIG_HOME/gtk-3.0/bookmarks
settle 2
check "removing an entry hides that folder" \
    "d ${M}d|y/shots ${M}shots (y)|x/shots ${M}shots (x)|My%20Photos ${M}My Photos|b ${M}b|"
setting "get_strv('hidden-folders').length" | grep -q "'1'" && echo "PASS  hidden folder remembered" || { echo "FAIL  hidden folder not remembered"; fails=$((fails+1)); }

sed -i "s#${M}d\$#pinned d#" $XDG_CONFIG_HOME/gtk-3.0/bookmarks
settle 2
check "renaming an entry pins it as an own bookmark" \
    "y/shots ${M}shots (y)|x/shots ${M}shots (x)|My%20Photos ${M}My Photos|b ${M}b|a ${M}a|"
grep -q "pinned d" $XDG_CONFIG_HOME/gtk-3.0/bookmarks && echo "PASS  pinned entry kept" || { echo "FAIL  pinned entry lost"; fails=$((fails+1)); }

setting "set_int('max-folders', 2)" >/dev/null; settle 2
check "the number of folders follows the setting" "y/shots ${M}shots (y)|x/shots ${M}shots (x)|"

ev "new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.privacy'}).set_boolean('remember-recent-files', false)" >/dev/null; settle 2
check "nothing is shown while recent files are off" ""
ev "new imports.gi.Gio.Settings({schema_id: 'org.gnome.desktop.privacy'}).set_boolean('remember-recent-files', true)" >/dev/null; settle 2
check "shown again when recent files are back on" "y/shots ${M}shots (y)|x/shots ${M}shots (x)|"

ev "Main.extensionManager.disableExtension('$UUID')" >/dev/null; settle 2
check "disabling leaves only the user's bookmarks" ""
[ "$(grep -c . $XDG_CONFIG_HOME/gtk-3.0/bookmarks)" = 2 ] && echo "PASS  Documents and the pinned folder remain" || { echo "FAIL  bookmarks after disable:"; cat $XDG_CONFIG_HOME/gtk-3.0/bookmarks; fails=$((fails+1)); }

if grep -E "JS ERROR|JS WARNING|Quick Access|$UUID" $R/shell.log; then echo "FAIL  errors in the shell log"; fails=$((fails+1)); fi
echo; [ $fails = 0 ] && echo "All checks passed" || echo "$fails check(s) failed"
exit $fails
