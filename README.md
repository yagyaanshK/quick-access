# Quick Access

A GNOME Shell extension that keeps your most recently used folders in the
sidebar of every Open and Save dialog, and of Files, like Quick Access on
Windows. Save a photo into a folder once and that folder is one click away the
next time any app asks where to save.

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

## Install

GNOME Shell 50.

```sh
git clone https://github.com/yagyaanshK/quick-access.git
cd quick-access
./install.sh
```

Log out and back in, then `gnome-extensions enable quick-access@yagyaanshK.github.com`.

## Related upstream work

Quick Access fills a gap until GNOME has it built in:

- The natural home for this is a "recent folders" section in the sidebar of
  Files (Nautilus), which also draws GNOME's file dialogs on GNOME 50. A proposal
  to the Nautilus project is being prepared.
- GNOME's file dialog already remembers the last folder per app. It skips apps it
  cannot identify; the Signal case is reported in
  [Signal-Desktop#6239](https://github.com/signalapp/Signal-Desktop/issues/6239).

## License

GPL-3.0-or-later. Contributions need the [CLA](CLA.md), which lets the copyright
holder also offer the code under other licenses.

Developed with AI assistance (Claude). I have reviewed and tested it and maintain it.
