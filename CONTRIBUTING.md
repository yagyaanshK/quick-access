# Contributing

Quick Access is a GNOME Shell extension written in plain JavaScript modules. No
build step, no dependencies.

## Setup

```sh
git clone https://github.com/yagyaanshK/quick-access.git
cd quick-access
./install.sh        # copies into ~/.local/share/gnome-shell/extensions
```

Log out and back in once so GNOME Shell picks the folder up, then enable it with
the Extensions app or `gnome-extensions enable quick-access@yagyaanshK.github.com`.

## Tests

`src/recents.js` (which folders count, their labels, how they merge into the
bookmarks file) has no GNOME dependency and is tested with node:

```sh
node --test
```

`tests/headless.sh` runs the whole extension in a throwaway headless GNOME Shell
with its own config and data folders, so your real bookmarks and recent files
are never touched. It writes recent-file entries, then checks the sidebar
bookmarks it produces: ordering, name clashes, removing and renaming entries,
the folder count, the "remember recent files" privacy switch and clean-up on
disable.

```sh
tests/headless.sh
```

Run both before opening a pull request and say so in it.

## Rules

- The user's own bookmarks are never reordered, renamed or removed. Quick Access
  only touches lines whose label starts with its clock mark.
- Respect GNOME's privacy setting: with "remember recent files" off, show nothing.
- Plain descriptive commit messages. No "Co-Authored-By" trailers, no "generated
  with" lines, no tool attribution of any kind in commits, pull requests or code.
- Contributions need the [CLA](CLA.md); see the licensing note in the README.
