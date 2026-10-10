#!/bin/bash
# Installs Quick Access into the current user's GNOME Shell extensions folder.
set -e
UUID="quick-access@yagyaanshK.github.com"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
SRC="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$DEST"
rsync -a --delete \
    --exclude .git --exclude tests --exclude node_modules --exclude package.json \
    --exclude '*.md' --exclude install.sh --exclude zip.sh --exclude assets \
    "$SRC/" "$DEST/"
glib-compile-schemas "$DEST/schemas"

echo "Installed to $DEST"
echo "Log out and back in, then enable it:  gnome-extensions enable $UUID"
