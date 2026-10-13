# Quick Access

A GNOME Shell extension that keeps your most recently used folders in the
sidebar of every Open and Save dialog, and of Files, like Quick Access on
Windows. Save a photo into a folder once and that folder is one click away the
next time any app asks where to save.

It also gives the apps in your dock a jump list, as on Windows 11: right-click
Files, VS Code or any other app and its pinned and recent folders or files are
right there.

```
Documents
Downloads
...
🕘 screenshots (005_event_mgmt)
🕘 Screenshots (Pictures)
🕘 downloads
```

## How it works

GNOME already records every file you open or save (`~/.local/share/recently-used.xbel`;
it is what the "Recent" view shows). Quick Access reads that list, works out the
folders those files live in, and keeps the newest five as bookmarks in
`~/.config/gtk-3.0/bookmarks`, which is the sidebar that GTK apps, the GNOME file
dialog and Files all share. Its own entries carry a 🕘 mark; your bookmarks are
never reordered, renamed or removed.

- **Newest first.** Saving or opening a file moves its folder to the top.
- **Remove an entry** (right-click, Remove) to hide that folder for good.
- **Rename an entry** to pin it: it becomes a normal bookmark and stays.
- Folders already in the sidebar (home, your own bookmarks) are skipped, as are
  hidden folders, `/tmp` and folders that no longer exist or sit on a drive that
  is not mounted.
- With **Settings → Privacy → File History** turned off, nothing is shown.
- Disabling the extension removes its entries and leaves your bookmarks as they were.

Preferences: the number of folders (1–10), whether to skip folders already in the
sidebar, and a button to show hidden folders again.

## Dock jump lists

Right-click an app in Ubuntu Dock or Dash to Dock (or in GNOME's own dash and
app grid) and its menu starts with a jump list:

```
Files ──────────────
Pinned ─────────────
  006_kagaz
Recent Folders ─────
  Downloads
  projects — ubuntu
  projects — ~
──────────────────────
New Window
```

- **Files** lists recent folders: folders you opened and the folders of files
  you opened or saved, as in the sidebar.
- **VS Code** (also Code - OSS, VSCodium and Insiders) lists its own recently
  opened folders and workspaces, read from its `state.vscdb`. GNOME Shell cannot
  read SQLite, so a short Python script (`src/vscdb.py`) reads it, read-only, in
  the background; it only runs again after VS Code changed the file.
- **Any other app** lists recent files of the types it opens (the `MimeType` of
  its desktop file, including subtypes, so Text Editor shows every kind of text
  file). Apps that open no files get no list.

Entries show the folder or file name; when two have the same name, the end of
their parent path is added in grey. Hover an entry to see its full path and two
buttons at its end:

- **Pin** moves it to the Pinned section at the top, which keeps the order you
  pinned in. On a pinned entry the button unpins it.
- **Remove** (×) takes it off that app's list. It deletes nothing, and
  `recently-used.xbel` and VS Code's history are left as they are. Removing a
  pinned entry just unpins it.

Click an entry to open it with the app; middle-click to open it in a new window
(through the app's "New Window" action). Pins and removed entries are kept per
app. Files that no longer exist, files outside your computer and system places
such as `/tmp` are skipped. With **File History** off, only pins are shown.

Preferences: jump lists on or off, the number of recent entries (1–20, 10 by
default, pins come on top), and buttons to unpin everything or show removed
entries again.

## Install

GNOME Shell 50. VS Code jump lists also need `python3` (part of every Ubuntu
install).

```sh
git clone https://github.com/yagyaanshK/quick-access.git
cd quick-access
./install.sh
```

Log out and back in, then `gnome-extensions enable quick-access@yagyaanshK.github.com`.

## Related upstream work

Quick Access fills a gap until GNOME has it built in:

- The natural home for this is a "recent folders" section in the sidebar of
  Files (Nautilus), which also draws GNOME's file dialogs on GNOME 50.
- GNOME's file dialog already remembers the last folder per app. It skips apps it
  cannot identify; the Signal case is reported in
  [Signal-Desktop#6239](https://github.com/signalapp/Signal-Desktop/issues/6239).

## License

GPL-3.0-or-later. Contributions need the [CLA](CLA.md), which lets the copyright
holder also offer the code under other licenses.

Developed with AI assistance (Claude). I have reviewed and tested it and maintain it.
