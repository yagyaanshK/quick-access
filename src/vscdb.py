# Prints VS Code's "recently opened" list from its state database, as the JSON
# VS Code stored it, or nothing if it has none. Quick Access runs it with
# "python3 -I" because GNOME Shell has no SQLite binding of its own.
#
#   python3 -I vscdb.py ~/.config/Code/User/globalStorage/state.vscdb
#
# The database is opened read-only and never changed.

import pathlib
import sqlite3
import sys

KEY = 'history.recentlyOpenedPathsList'


def main(path):
    uri = pathlib.Path(path).absolute().as_uri() + '?mode=ro'
    try:
        db = sqlite3.connect(uri, uri=True, timeout=2)
        try:
            row = db.execute('SELECT value FROM ItemTable WHERE key = ?', (KEY,)).fetchone()
        finally:
            db.close()
    except sqlite3.Error as e:
        print(f'{path}: {e}', file=sys.stderr)
        return 1

    if row and row[0] is not None:
        value = row[0]
        if isinstance(value, bytes):
            value = value.decode('utf-8', 'replace')
        sys.stdout.write(value)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
