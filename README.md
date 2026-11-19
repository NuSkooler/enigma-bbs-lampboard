# lampboard

A message index for [ENiGMA½ BBS](https://github.com/NuSkooler/enigma-bbs): one table lists every conference and message area the caller can read, with its total, new and "to you" counts and the date of the last post. Pick an area to read it; you come back to the index, which has moved on to the next area with new mail.

If your callers know Mystic's `MI` message index or Synchronet DDMsgReader's indexed mode, this is that, for ENiGMA½.

```
 lampboard -- Message Index ─────────────────────────────────────────────
    Area                                    Total   New Yours Last Post
───── System Internal ──────────────────────────────────────────────────
NEW Private Mail                                2     1     1 never
    System Bulletins                            0     -     - never
───── fsxNet ───────────────────────────────────────────────────────────
NEW fsxNet General                            100     5     - 18 Nov 26
    BBS Discussion                             20     -     - never
```

The Enigma machine's lampboard lit up letters; this lights up the areas with new mail.

**Needs:** ENiGMA½ 0.6.1-beta or later (lampboard checks for the features it uses at startup rather than the version number) and an ANSI terminal (RIP callers count: RIP is a layer on ANSI).

> **The art shipped here is a plain placeholder.** It carries the MCI layout described below and nothing more. Replace it with your own (see [Art](#art)).

## Install

1. Clone (or copy, or symlink) this repository as `mods/lampboard` in your ENiGMA½ folder:

    ```
    cd /path/to/enigma-bbs/mods
    git clone https://github.com/NuSkooler/enigma-bbs-lampboard.git lampboard
    ```

    There is no `npm install` step: lampboard has no dependencies of its own and uses ENiGMA½'s.

2. Restart ENiGMA½ once. Mods are loaded at startup; menu changes after that hot-reload. The log shows `lampboard: ready (core features found)` (info), or a warning if something is missing, followed by `lampboard: ready, with the limits warned about above` when lampboard still works (see [Troubleshooting](#troubleshooting)).

## Add the menus

Copy `menus/lampboard.hjson` into `config/menus/` and add it to the `includes` list of your main menu file:

```hjson
includes: [
    ...
    lampboard.hjson
]
```

Or paste the entries into your menu file. It holds three entries:

| Entry | What it is |
|---|---|
| `lampboardMain` | The index from the main menu. Quit goes back. |
| `lampboardLogin` | The login new scan. With nothing new it goes straight on to `next` without drawing anything; quit (and `x` in the message list) also go on to `next`. |
| `fullLoginSequenceFileScan` | A files-only new scan (`new_scan` with `skipMessageBase: true`), for keeping the file new scan at login (below). |

The two lampboard entries are the same apart from `next`: that is the only thing that makes the login flow different. Each entry is customised separately in `theme.hjson`.

The menu entries have no `art` key on purpose: lampboard draws its art itself from `config.art.main` / `config.art.help`.

An include cannot change your existing menus, so the routing below is an edit to your own menu file either way.

## Route callers to it

Lampboard is usually offered as a per-user choice next to the stock new scan, through the `pref__msg_reader` user preference (the [user_pref_select](https://enigma-bbs.github.io/modules/user-pref-select/) docs show the whole setup). An unset preference matches nothing, so the last entry of each list is the board default.

**The main menu's `!`** (in `mainMenu`'s `submit`):

```hjson
{
    value: { command: "!" }
    action: [
        {
            acs: "PV[pref__msg_reader,lampboard] & TE[ansi]"
            action: @menu:lampboardMain
        }
        {
            action: @menu:mainMenuGlobalNewScan
        }
    ]
}
```

**The login new scan prompt** (in `fullLoginSequenceNewScanConfirm`'s `submit`):

```hjson
{
    value: { promptValue: 0 }
    action: [
        {
            acs: "PV[pref__msg_reader,lampboard] & TE[ansi]"
            action: @menu:lampboardLogin
        }
        {
            action: @menu:fullLoginSequenceNewScan
        }
    ]
}
```

For a board-wide switch instead, point both straight at `@menu:lampboardMain` / `@menu:lampboardLogin` (keep the `TE[ansi]` branch if you have PETSCII or ATASCII callers).

Do **not** put an `acs` in the lampboard menus' own `config`: a menu whose ACS fails leaves the caller where they were with no message (or stuck at login). Route with the ACS on the action instead, as above. As a safety net, lampboard sends a non-ANSI caller who reaches it anyway back with a short message (main entry) or straight on (login entry).

**Offer the choice** with a `user_pref_select` choice:

```hjson
{
    value: lampboard
    text: Index reader
    desc: A table of areas with new mail; pick one to read
    acs: "TE[ansi]"
}
```

### Keeping the file new scan at login

The stock login new scan also scans the file base; lampboard reads messages only. To keep the file new scan for lampboard users, chain the files-only entry:

```
lampboardLogin -> fullLoginSequenceFileScan -> fullLoginSequenceSysStats
```

In `lampboardLogin`, change `next: fullLoginSequenceSysStats` to `next: fullLoginSequenceFileScan`. The `fullLoginSequenceFileScan` entry in `menus/lampboard.hjson` already goes on to `fullLoginSequenceSysStats`.

> **This needs an ENiGMA½ whose `new_scan` has `skipMessageBase`** (NuSkooler/enigma-bbs#1126). An older `new_scan` ignores the option, so the chain would run the full message new scan again after lampboard. On such a version leave `next` as shipped.

## Keys

| Key | Action |
|---|---|
| Enter | Read the highlighted area |
| `n`, Tab | Next area with new messages (wraps) |
| `v` | Toggle your new scan areas / all areas |
| `f` | Toggle showing only areas with new messages |
| `m` | Mark the highlighted area read (asks first) |
| `r` | Re-scan for new messages |
| `s` | Sort by the next column; after the last, back to board order |
| `o` | Flip the sort order |
| `?`, `h` | Help |
| `q`, Esc | Quit |

Arrows, Page Up/Down, Home and End move through the table as in any ENiGMA½ list; lampboard does not bind them.

The bindings are the `actionKeys` in the menu entries, so you can change them. For a Mystic feel, add the Ctrl variants to the same entries:

```hjson
{
    keys: [ "n", "shift + n", "tab", "ctrl + n" ]
    action: @method:nextNew
}
```

The methods are `readArea`, `nextNew`, `toggleScope`, `toggleFilter`, `markRead`, `rescan`, `cycleSort`, `toggleSortOrder`, `help` and `quit`.

## How it behaves

- **Scope.** It starts on your new scan areas (what the stock new scan would scan: your configured selection, or every area if you have not made one); `v` switches to every area you can read. Private mail and bulletins (System Internal) come first. Hidden conferences that new scan scans (such as ActivityPub) are listed in both scopes.
- **Reading.** Enter opens your operator's new scan message list for the area (`newScanMessageList`), which starts at the first new message. Reading on past the last message brings you back to the index. An area with nothing new opens at its newest message (on an ENiGMA½ with `msg_list`'s `focusWhenNoneNew`; older versions open at the first). ActivityPub areas open the ActivityPub browser, and their pointer moves to the newest post first, as with the stock new scan.
- **Coming back** from reading rebuilds the counts (one query) and moves the highlight to the next area with new mail if the one you read is done. Your scope, filter and sort stay as you left them while you are in the index (reading an area and coming back keeps them); leaving the index and entering it again starts from the configured defaults.
- **`x` in the message list** leaves the index too (back to the menu, or on with the login).

## Configuration

Set these in the menu entry's `config`, or in `theme.hjson` under `customization.menus.lampboardMain.config` (and `lampboardLogin`), which deep-merges. Every key has a default in code.

| Key | Default | Meaning |
|---|---|---|
| `art.main` | `LAMPBRD` | Index art |
| `art.help` | `LAMPBRDHLP` | Help art; any key returns |
| `messageListMenu` | `newScanMessageList` | Menu opened on Enter (a `msg_list` entry) |
| `activityPubListMenu` | `newScanActivityPubList` | Menu for ActivityPub areas |
| `initialScope` | `newscan` | `newscan` or `all`. The login entry's "nothing new, skip" check looks at this scope |
| `hideNoNew` | `false` | Start with areas that have nothing new hidden |
| `omitMessageAreaTags` | `[]` | Area tags never shown |
| `snapToNew` | `true` | Move to the next area with new messages on entry, on return and after marking read |
| `confirmMarkRead` | `true` | Ask before marking an area read |
| `newIndicator` | `NEW` | `{newIndicator}` on rows with new messages (empty otherwise) |
| `dateTimeFormat` | the theme's | `{lastPost}` in the text formats (the table column has its own `dateFormat`) |
| `neverText` | `never` | `{lastPost}` for an area with no posts |
| `lastPostLineFormat` | `\|08Last post \|07{lastPost}` | `{lastPostLine}`: this format, or nothing when no area is highlighted (an empty table) |
| `areaDescFormat` | `{areaDesc}` | `%TL3` |
| `statusIdleFormat` | `{newAreaCount} of {areaCount} areas have new messages` | `%TL2` when no message is showing |
| `noNewText` | `No new messages` | `%TL2` when nothing is new |
| `noMoreNewText` | `No other areas with new messages` | `n` found nothing else |
| `noMessagesText` | `{areaName} has no messages` | Enter on an empty area |
| `markReadConfirmFormat` | `Mark {areaName} read?` | The question |
| `confirmSuffix` | ` \|08[\|15y\|08/\|15N\|08] ` | After the question |
| `markedReadFormat` | `Marked {areaName} read` | After marking |
| `rescanFormat` | `Re-scanned: {changed} area(s) changed` | After `r` |
| `scopeNewScanText` / `scopeAllText` | `Your new scan areas` / `All areas` | `{scopeText}`; also shown on `v` |
| `filterOnText` / `filterOffText` | `Only areas with new messages` / `All areas shown` | `{filterText}`; also shown on `f` |
| `sortFormat` | `Sorted by {sortLabel} {sortOrderText}` | `{sortText}`; shown on `s`/`o` |
| `sortAscText` / `sortDescText` | `ascending` / `descending` | `{sortOrderText}` |
| `moduleOrderText` | `board order` | `{sortLabel}` in board order |
| `emptyText` | `\|08No message areas to show` | The table when no areas are in scope |
| `emptyNoNewText` | `\|08No new messages` | The table when `hideNoNew` hides everything |
| `unsupportedTerminalText` | `The message index needs an ANSI terminal.` | Main entry, non-ANSI caller |
| `unsupportedCoreText` | `The message index is not available right now.` | Main entry, ENiGMA½ too old |
| `menuUnavailableText` | `That area cannot be opened right now.` | Enter when the message list menu cannot be opened |
| `mainInfoFormat10`, `11`, ... | see below | The `%TL10`+ custom range |

The flow (main or login) is not a key: it is whether the entry has a `next`. Key bindings are `actionKeys`. Lampboard clears the screen itself when it draws.

### Fields for the text formats

`areaDescFormat`, `statusIdleFormat`, the messages and `mainInfoFormat10`+ can use:

- **The highlighted area:** `{areaTag}`, `{areaName}`, `{areaDesc}`, `{confTag}`, `{confName}`, `{confDesc}`, `{total}`, `{newCount}`, `{yours}`, `{lastPost}` (formatted with `dateTimeFormat`), `{lastPostLine}` (see `lastPostLineFormat`), `{newIndicator}`. With nothing highlighted (an empty table) these are empty.
- **The summary:** `{areaCount}`, `{newAreaCount}`, `{totalNew}`, `{totalYours}`, `{scope}` (`newscan` or `all`), `{scopeText}`, `{filterText}`, `{sortText}`.

### The custom range (`%TL10`+)

On an ENiGMA½ with module default info formats, lampboard ships these:

| Format | Default |
|---|---|
| `mainInfoFormat10` | `{lastPostLine}` |
| `mainInfoFormat11` | `\|07{sortText}` |
| `mainInfoFormat12` | `\|07{scopeText}\|08, \|07{filterText}` |

Any value you set wins, including `""` or `null`, which hide the view. Add `mainInfoFormat13` and up for more `%TL` views in your art. On older versions only the formats you set are drawn.

### Table layout

The table's columns, colours and group rows have defaults in code. Override any part in the menu's or the theme's `mci.TV1`; `columns`, `stateSGR`, `sort`, `group` and `sortIndicator` deep-merge, so you can change one column's colour without restating the table. Arrays (`columnOrder`, `sortable`, a column's `rules`, `sort.then`) replace.

The defaults:

```hjson
header: true
headerSGR: "|00|15"
separator: " |08│ "
focusSGR: "|00|17"
sortable: [ "area", "new", "yours", "total", "last" ]
columnOrder: [ "flag", "area", "total", "new", "yours", "last" ]
columns: {
    flag: { field: "newIndicator", width: 3, sgr: "|15" }
    area: { field: "areaName", label: "Area", width: "fill", textOverflow: ".." }
    total: { field: "total", label: "Total", type: "number", width: 6, format: "{value:,}", sgr: "|03", sortOrder: "desc" }
    new: {
        field: "newCount", label: "New", type: "number", width: 5, sgr: "|08", sortOrder: "desc"
        rules: [ { when: "> 0", sgr: "|10" }, { when: "= 0", text: "-" } ]
    }
    yours: {
        field: "yours", label: "Yours", type: "number", width: 5, sgr: "|08", sortOrder: "desc"
        rules: [ { when: "> 0", sgr: "|13" }, { when: "= 0", text: "-" } ]
    }
    last: { field: "lastPostTs", label: "Last Post", type: "date", dateFormat: "DD MMM YY", width: 9, nullText: "|08never", minTermWidth: 64, sortOrder: "desc" }
}
group: { format: "|08───── |15{confName} ", fillChar: "|08─" }
stateSGR: { new: "|15", personal: "|11" }
```

(Shown compressed; in your own files keep each object on its own lines, as below.) There is no default `sort`: rows stay in board order. Row states are `personal` (new mail to you) and `new`; group rows take the "highest" state of their areas and have the sums `{areaCount}`, `{newAreaCount}`, `{newCount}`, `{yours}` for their `format`, e.g. `"|08───── |15{confName} |08({newCount} new) "`. The Last Post column hides below 64 columns.

### Sample `theme.hjson`

```hjson
customization: {
    menus: {
        lampboardMain: {
            config: {
                newIndicator: "|12*"
                statusIdleFormat: "|07{newAreaCount}|08/|07{areaCount} areas lit"
                mainInfoFormat10: "|08Last post: |07{lastPost}"
            }
            mci: {
                TV1: {
                    height: 16
                    //  Mystic-style: areas with new mail first within each conference
                    sort: {
                        column: new
                        order: desc
                        then: area
                    }
                    columns: {
                        last: {
                            dateFormat: MMM DD
                        }
                    }
                    stateSGR: {
                        personal: "|13"
                    }
                }
            }
        }
        //  lampboardLogin takes the same block (each menu entry is customised separately)
    }
}
```

## Art

Lampboard draws two screens: `LAMPBRD` (the index) and `LAMPBRDHLP` (help, any key returns). The shipped files in `art/` are plain placeholders.

To use your own, put a file of the same name in your theme folder: it wins over the mod's copy (lookup order: theme, default theme, `mods/lampboard/art`, `art/general`). Or set `config.art.main` / `config.art.help` (works from `theme.hjson` too).

The index art's MCI codes (form 0):

| MCI | Required | Contents |
|---|---|---|
| `%TV1` | yes | The area table |
| `%TL2` | no | Status line: messages, the mark-read question, the idle summary |
| `%TL3` | no | The highlighted area's description (`areaDescFormat`) |
| `%TL10`+ | no | The custom range (`mainInfoFormat10`, ...) |

Sizes (`height`, `width`) go in the menu's `mci` block as usual; the shipped entries match the placeholder art (an 80x24 screen with the table at row 3, 16 rows high). Predefined MCI codes such as `%UN` work in the art as anywhere else. Keep the help text in the art (the placeholder has a key strip on the index and the full list on the help screen).

## Notes

- **No file new scan.** Lampboard reads messages. See [Keeping the file new scan at login](#keeping-the-file-new-scan-at-login).
- **An area with nothing new** opens at its newest message only on an ENiGMA½ whose `msg_list` has `focusWhenNoneNew`; older versions open at the first message.
- **`interrupt: realtime`** on a lampboard menu re-creates it when a message arrives, which resets the highlight, scope and sort. The default (queued) does not. While the help screen or the mark-read question is up, messages are held and shown by the next menu, as with queued (the key that dismisses a message would otherwise also close help or answer the question).
- **Areas with new messages to you** are counted by name, as ENiGMA½'s new scan does; all new private mail counts as yours.

## Troubleshooting

- **A `lampboard: ENiGMA½ ... lacks ...` line at startup:** your ENiGMA½ is too old. Menus using lampboard send callers on (login) or show `unsupportedCoreText` (main menu). Update ENiGMA½.
- **`lampboard: no mod art fallback`:** your ENiGMA½ does not look in `mods/lampboard/art`. Copy `art/*` into your theme folder or `art/general`.
- **`lampboard: no default custom info formats`:** the `%TL10`+ defaults above are not applied; set `mainInfoFormat10` etc. yourself if you want them.
- **"The message index needs an ANSI terminal":** a PETSCII or ATASCII caller reached lampboard. Add `& TE[ansi]` to the routing ACS (above).
- **`lampboard: art "..." has no %TV1`:** the art lacks the table. The main entry falls back to the previous menu; the login entry carries on with the login.

## Development

```
npm install          # dev tools only (eslint, prettier, hjson)
npm test             # unit tests, no ENiGMA½ needed
ENIGMA_ROOT=/path/to/enigma-bbs npm run test:integration
npm run lint
```

- The integration tests need an ENiGMA½ checkout with `npm ci` done in it. `ENIGMA_ROOT` is also the first place lampboard looks for ENiGMA½'s core (then two folders up from the mod, the main script's folder and the current folder), so the mod works copied or symlinked.
- **Keep `lampboard.js` the only `.js` file at the top of the repository.** ENiGMA½ requires every top-level `.js` file in a mod folder at startup; helpers go in `lib/`, tooling config is `.mjs` or `.json`.
- Only `core/menu_module.js` is required at load time. Everything newer is loaded after the feature check (`lib/compat.js`), so an old core logs one warning instead of failing to load the module.
- `lib/defaults.js`, `lib/rows.js` and `lib/nav.js` are pure and have no ENiGMA½ imports.

## Licence

BSD-2-Clause, as ENiGMA½. See `LICENSE`.
