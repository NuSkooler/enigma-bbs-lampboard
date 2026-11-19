# Changelog

All notable changes to lampboard are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- First version: a message index for ENiGMA½ 0.6.1-beta and later.
  - One table (`%TV1`) of every readable conference and area with total, new and "to you" counts and the last post date; System Internal first, then board order.
  - Scope toggle between the new scan areas and all areas, and a filter for areas with new messages, both without a new query.
  - Enter opens the operator's new scan message list (`focusWhenNoneNew: 'last'`); ActivityPub areas open the ActivityPub browser after moving the pointer, as the stock new scan does.
  - Next-new, mark area read (inline y/N), re-scan, a sort cycle that returns to board order, and a help screen.
  - Two menu entries: `lampboardMain` and `lampboardLogin` (skips straight to `next` when nothing is new), plus a files-only `fullLoginSequenceFileScan` entry for the login chain.
  - Defaults in code for every `config` key, the table layout (`tv.setDefaults()`) and the `%TL10`+ formats; overrides through menu and `theme.hjson` as usual.
  - Feature detection at startup and on entry instead of a version gate; non-ANSI callers are sent on or back with a message.
  - Placeholder art (`LAMPBRD`, `LAMPBRDHLP`).
