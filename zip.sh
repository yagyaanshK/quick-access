#!/bin/bash
# Builds the zip that 'gnome-extensions install' accepts.
set -e
cd "$(dirname "$0")"
UUID="quick-access@yagyaanshK.github.com"
rm -f "$UUID.zip"
zip -r "$UUID.zip" extension.js prefs.js metadata.json stylesheet.css LICENSE src schemas \
    -x 'schemas/gschemas.compiled'
echo "Wrote $UUID.zip"
