'use strict';

//
//  lampboard: a message index for ENiGMA½ BBS. One table lists every
//  conference and area the caller can read with its new message counts, in
//  the manner of Mystic's MI command and Synchronet DDMsgReader's indexed
//  mode. Enter reads an area through the operator's new scan message list.
//
//  This is the only .js file at the top of the mod folder: ENiGMA requires
//  every top-level .js in a mod folder at startup, so helpers live in lib/.
//
//  Only menu_module.js (present in every ENiGMA version) is required at the
//  top; everything newer is loaded lazily behind the feature check in
//  lib/compat.js, so an old core logs one warning instead of failing to load
//  the module.
//
const { requireCore, requireFromRoot, requireDep } = require('./lib/enigma_root.js');
const compat = require('./lib/compat.js');
const {
    Scopes,
    mergeDefaults,
    tableDefaults,
    infoFormatDefaults,
} = require('./lib/defaults.js');
const { buildRows, rowPatch, rowKeys, infoFields, isAreaRow } = require('./lib/rows.js');
const {
    pickFocusIndex,
    visibleSortable,
    nextSortColumn,
    normalizeSort,
    normalizeSavedState,
    describeSort,
} = require('./lib/nav.js');

const core = name => requireCore(__dirname, name);
const loadFromRoot = relPath => requireFromRoot(__dirname, relPath);

const { MenuModule } = core('menu_module.js');

exports.moduleInfo = {
    name: 'lampboard',
    desc: 'Message index: every conference and area with its new message counts',
    author: 'NuSkooler',
    packageName: 'codes.l33t.enigma.lampboard',
};

const FormName = 'main';
const FormId = 0;

const MciViewIds = {
    table: 1, //  %TV1
    status: 2, //  %TL2
    areaDesc: 3, //  %TL3
    customRangeStart: 10, //  %TL10+
};

const noop = () => {};

//  core modules newer than 0.6.0: only after the compat check passed
function messageArea() {
    return core('message_area.js');
}

function stringFormat(fmt, obj, client) {
    return core('string_format.js')(fmt || '', obj || {}, { client });
}

function coreLog() {
    return core('logger.js').log;
}

//  callers already told the core is unsupported (one warn per session)
const warnedClients = new WeakSet();

exports.moduleInitialize = (initInfo, cb) => {
    try {
        const result = compat.getCompat(loadFromRoot);
        const log = coreLog();
        if (!result.ok) {
            if (log) {
                log.warn(
                    { missing: result.missing, version: result.version },
                    compat.describeFailure(result)
                );
            }
        } else if (log) {
            result.warnings.forEach(w =>
                log.warn({ version: result.version }, `lampboard: ${w}`)
            );
            log.info(
                { version: result.version },
                'lampboard: ready (core features found)'
            );
        }
    } catch (e) {
        //  never fail the boot
    }
    return cb(null);
};

exports.getModule = class LampboardModule extends MenuModule {
    constructor(options) {
        super(options);

        //  menuConfig is the shared, cached theme object: the merged copy
        //  with defaults lives here and menuConfig is never written to
        this.config = mergeDefaults(this.menuConfig.config);

        this.fullExitRequested =
            true === (options.lastMenuResult && options.lastMenuResult.fullExit);

        this.scope = this.config.initialScope;
        this.hideNoNew = this.config.hideNoNew;
        this.sortChanged = false;
        this.userSort = undefined;
        this.savedState = null;
        this.loaded = false;
        this.rows = [];
        this.totals = null;
        this.statusMessage = null;

        this.menuMethods = {
            readArea: (formData, extraArgs, cb) => this.readArea(cb),
            nextNew: (formData, extraArgs, cb) => this.nextNew(cb),
            toggleScope: (formData, extraArgs, cb) => this.toggleScope(cb),
            toggleFilter: (formData, extraArgs, cb) => this.toggleFilter(cb),
            markRead: (formData, extraArgs, cb) => this.markRead(cb),
            rescan: (formData, extraArgs, cb) => this.rescan(cb),
            cycleSort: (formData, extraArgs, cb) => this.cycleSort(cb),
            toggleSortOrder: (formData, extraArgs, cb) => this.toggleSortOrder(cb),
            help: (formData, extraArgs, cb) => this.help(cb),
            quit: (formData, extraArgs, cb) => this.nextMenu(cb),
        };
    }

    //  ── Lifecycle ────────────────────────────────────────────────────────────

    getDefaultCustomInfoFormats(formName) {
        return infoFormatDefaults(formName);
    }

    getSaveState() {
        const tv = this.table();
        const focused = tv ? tv.getFocusedItem() : null;
        return {
            scope: this.scope,
            hideNoNew: this.hideNoNew,
            sortChanged: this.sortChanged,
            userSort: this.sortChanged ? normalizeSort(this.userSort) : undefined,
            focusKey: focused ? focused.key : undefined,
            focusIndex: tv ? tv.focusedItemIndex : undefined,
            readAreaTag: this.readAreaTag,
        };
    }

    //  runs before enter() on a return from reading (a new instance)
    restoreSavedState(savedState) {
        const saved = normalizeSavedState(savedState);
        this.savedState = saved;
        if (saved.scope) {
            this.scope = saved.scope;
        }
        if (undefined !== saved.hideNoNew) {
            this.hideNoNew = saved.hideNoNew;
        }
        if (saved.sortChanged) {
            this.sortChanged = true;
            this.userSort = saved.userSort;
        }
    }

    enter() {
        //  'x' in the message list: leave the index too, as new_scan does
        if (this.fullExitRequested) {
            return this.nextMenu(noop);
        }

        const result = compat.getCompat(loadFromRoot);
        if (!result.ok) {
            return this.leaveUnsupported('core', result);
        }
        if (!this.isAnsiCaller()) {
            return this.leaveUnsupported('terminal');
        }

        //  login flow, first entry: nothing new means straight on to |next|,
        //  before anything is drawn
        if (this.haveNext() && !this.savedState) {
            return this.loadData(err => {
                if (this.left) {
                    return;
                }
                if (!err && 0 === this.totals.totalNew) {
                    return this.nextMenu(noop);
                }
                return super.enter();
            });
        }

        return super.enter();
    }

    leave() {
        //  callbacks still in flight (stats, help, mark read) must not draw
        //  over, or re-attach input to, whatever menu comes next
        this.left = true;
        this.removeConfirmHandler();
        this.removeHelpHandler();
        super.leave();
    }

    isLoginEntry() {
        return this.haveNext();
    }

    isAnsiCaller() {
        const term = this.client.term || {};
        const emulation = term.emulation;
        return 'ansi' === (emulation ? emulation.name : 'ansi');
    }

    leaveUnsupported(reason, result) {
        if ('core' === reason) {
            if (!warnedClients.has(this.client)) {
                warnedClients.add(this.client);
                this.client.log.warn(
                    { missing: result.missing, version: result.version },
                    compat.describeFailure(result)
                );
            }
        } else {
            const emulation = this.client.term && this.client.term.emulation;
            this.client.log.debug(
                { emulation: emulation ? emulation.name : undefined },
                'lampboard: not an ANSI terminal; skipping the message index'
            );
        }

        if (this.isLoginEntry()) {
            return this.nextMenu(noop);
        }

        const text =
            'core' === reason
                ? this.config.unsupportedCoreText
                : this.config.unsupportedTerminalText;
        this.client.term.rawWrite(core('ansi_term.js').resetScreen());
        this.client.term.write(
            `${core('color_codes.js').pipeToAnsi(text, this.client)}\n`
        );
        return this.pausePrompt(() => this.prevMenu(noop));
    }

    mciReady(mciData, cb) {
        super.mciReady(mciData, err => {
            if (err) {
                return cb(err);
            }

            //  a broken art file must not strand a login: send it on instead
            return this.drawMain(err => {
                if (err && this.isLoginEntry()) {
                    this.client.log.warn(
                        { error: err.message },
                        'lampboard: cannot draw the index; continuing the login'
                    );
                    this.nextMenu(noop);
                    return cb(null);
                }
                return cb(err);
            });
        });
    }

    //  ── Drawing ──────────────────────────────────────────────────────────────

    table() {
        return this.getView(FormName, MciViewIds.table);
    }

    drawMain(cb) {
        const artName = this.config.art.main;
        this.displayAsset(
            artName,
            { clearScreen: true, trailingLF: false },
            (err, artData) => {
                if (err) {
                    return cb(err);
                }

                this.prepViewController(FormName, FormId, artData.mciMap, (err, vc) => {
                    if (err) {
                        return cb(err);
                    }

                    const tv = vc.getView(MciViewIds.table);
                    if (
                        !tv ||
                        'TV' !== tv.mciCode ||
                        'function' !== typeof tv.setDefaults
                    ) {
                        return cb(new Error(`lampboard: art "${artName}" has no %TV1`));
                    }

                    tv.setDefaults(tableDefaults());
                    if (this.sortChanged) {
                        if (this.userSort) {
                            tv.setSort(this.userSort.column, this.userSort.order);
                        } else {
                            tv.setSort(null);
                        }
                    }
                    this.bindTableEvents();

                    const show = err => {
                        if (this.left) {
                            return cb(null);
                        }
                        if (err) {
                            this.client.log.warn(
                                { error: err.message },
                                'lampboard: cannot read message area stats'
                            );
                        }
                        this.applyRows({ initial: true });
                        if (err) {
                            this.setStatus(`Error: ${err.message}`);
                        }
                        return cb(null);
                    };

                    return this.loaded ? show(null) : this.loadData(show);
                });
            }
        );
    }

    bindTableEvents() {
        const tv = this.table();
        if (!tv) {
            return;
        }
        if (this.onIndexUpdate) {
            tv.removeListener('index update', this.onIndexUpdate);
        }
        this.onIndexUpdate = () => {
            this.statusMessage = null;
            this.updateInfo();
        };
        tv.on('index update', this.onIndexUpdate);
    }

    //  The rows into the table, focus placed, everything drawn.
    //  options.initial: focus per pickFocusIndex() (entry or return)
    //  options.keepFocus: keep the focused row by key (toggles, re-scan)
    applyRows(options = {}) {
        const tv = this.table();
        if (!tv) {
            return;
        }

        tv.setDefaults({ emptyText: this.emptyText() });
        tv.setItems(this.rows, { keepFocus: !!options.keepFocus });
        tv.redraw();

        if (options.initial) {
            const saved = this.savedState || {};
            const index = pickFocusIndex(tv.getItems(), {
                focusKey: saved.readAreaTag || saved.focusKey,
                focusIndex: saved.focusIndex,
                snapToNew: this.config.snapToNew,
            });
            if (index > -1 && index !== tv.focusedItemIndex) {
                tv.setFocusItemIndex(index);
            }
        }

        this.updateInfo();
    }

    emptyText() {
        const totals = this.totals || {};
        return this.hideNoNew && totals.scopeAreaCount > 0
            ? this.config.emptyNoNewText
            : this.config.emptyText;
    }

    //  ── Data ─────────────────────────────────────────────────────────────────

    //  Conferences and areas the caller can read, board order; hidden
    //  conferences (ActivityPub) and System Internal included, as new scan
    //  scans them
    listConfs() {
        const ma = messageArea();
        return ma
            .getSortedAvailMessageConferences(this.client, {
                includeSystemInternal: true,
                includeHidden: true,
            })
            .map(c => ({
                confTag: c.confTag,
                conf: c.conf,
                areas: ma.getSortedAvailMessageAreasByConfTag(c.confTag, {
                    client: this.client,
                    includeHidden: true,
                }),
            }));
    }

    //  One stats query over every readable area: scope and filter changes
    //  re-filter locally
    loadData(cb) {
        let confs;
        let selected;
        try {
            confs = this.listConfs();
            selected = messageArea().getNewScanMessageAreaTags(this.client);
        } catch (e) {
            return cb(e);
        }

        const tags = [];
        confs.forEach(c => c.areas.forEach(a => tags.push(a.areaTag)));

        messageArea().getMessageAreaStats(this.client.user, tags, (err, stats) => {
            if (err) {
                this.totals = this.totals || buildRows([], {}).totals;
                return cb(err);
            }
            this.confs = confs;
            this.selected = selected;
            this.stats = stats || {};
            this.loaded = true;
            this.rebuild();
            return cb(null);
        });
    }

    rebuild() {
        const built = buildRows(this.confs || [], this.stats || {}, {
            scope: this.scope,
            selected: this.selected,
            omit: this.config.omitMessageAreaTags,
            hideNoNew: this.hideNoNew,
            newIndicator: this.config.newIndicator,
        });
        this.rows = built.rows;
        this.totals = built.totals;
        return built;
    }

    //
    //  After stats changed: with no filter the rows stay the same, so only
    //  those that changed are redrawn (updateItem); otherwise (hideNoNew, or
    //  areas came or went) the table is rebuilt keeping focus.
    //  -> the number of area rows that changed
    //
    refreshRows() {
        const tv = this.table();
        const prevRows = tv ? tv.getItems() : [];
        const prevByKey = new Map(prevRows.map(r => [r.key, r]));
        const prevKeys = rowKeys(this.rows).slice().sort();

        this.rebuild();

        //  areas whose row changed or appeared, plus those that went away
        const nextKeys = new Set(rowKeys(this.rows));
        let changed = 0;
        this.rows.forEach(r => {
            if (isAreaRow(r) && rowPatch(prevByKey.get(r.key), r)) {
                changed += 1;
            }
        });
        prevRows.forEach(r => {
            if (isAreaRow(r) && !nextKeys.has(r.key)) {
                changed += 1;
            }
        });

        const sameKeys =
            JSON.stringify(prevKeys) ===
            JSON.stringify(rowKeys(this.rows).slice().sort());
        if (!tv) {
            return changed;
        }
        if (this.hideNoNew || !sameKeys) {
            this.applyRows({ keepFocus: true });
            return changed;
        }

        this.rows.forEach(r => {
            const patch = rowPatch(prevByKey.get(r.key), r);
            if (patch) {
                tv.updateItem(r.key, patch);
            }
        });
        tv.setDefaults({ emptyText: this.emptyText() });

        //  updateItem() does not re-sort. (setDefaults() above re-sorts the
        //  rows but does not redraw, so the screen would show the old order
        //  while n and the snap walk the new one.) With a sort in force,
        //  apply it again: changed rows move, the table redraws, focus stays
        //  on the same row.
        const sort = tv.getSort();
        if (changed > 0 && sort) {
            tv.setSort(sort.column, sort.order);
        }
        return changed;
    }

    //  ── Status and info views ────────────────────────────────────────────────

    setStatus(text) {
        this.statusMessage = text;
        this.drawStatus();
    }

    drawStatus() {
        const view = this.getView(FormName, MciViewIds.status);
        if (!view) {
            return;
        }
        const fields = this.fields();
        let text;
        if (null !== this.statusMessage && undefined !== this.statusMessage) {
            text = this.statusMessage;
        } else if (!this.totals || 0 === this.totals.totalNew) {
            text = stringFormat(this.config.noNewText, fields, this.client);
        } else {
            text = stringFormat(this.config.statusIdleFormat, fields, this.client);
        }
        view.setText(text);
    }

    //  TL2 (unless a message is up), TL3 and the %TL10+ range
    updateInfo() {
        const fields = this.fields();
        const descView = this.getView(FormName, MciViewIds.areaDesc);
        if (descView) {
            descView.setText(
                stringFormat(this.config.areaDescFormat, fields, this.client)
            );
        }
        this.drawStatus();
        this.updateCustomViewTextsWithFilter(
            FormName,
            MciViewIds.customRangeStart,
            fields
        );
    }

    sortText(tv) {
        tv = tv || this.table();
        const sort = tv ? tv.getSort() : null;
        const texts = describeSort(sort, tv ? tv.getConfig() : {}, this.config);
        return stringFormat(this.config.sortFormat, texts, this.client).trim();
    }

    fields() {
        const tv = this.table();
        const moment = requireDep(__dirname, 'moment');
        const dateTimeFormat = this.config.dateTimeFormat || this.getDateTimeFormat();
        return infoFields(tv ? tv.getFocusedItem() : null, this.totals, {
            scope: this.scope,
            scopeText:
                Scopes.all === this.scope
                    ? this.config.scopeAllText
                    : this.config.scopeNewScanText,
            filterText: this.hideNoNew
                ? this.config.filterOnText
                : this.config.filterOffText,
            sortText: tv ? this.sortText(tv) : '',
            neverText: this.config.neverText,
            lastPostLineFormat: this.config.lastPostLineFormat,
            formatDate: d => moment(d).format(dateTimeFormat),
            format: (fmt, obj) => stringFormat(fmt, obj, this.client),
        });
    }

    //  ── Actions ──────────────────────────────────────────────────────────────

    readArea(cb) {
        const tv = this.table();
        const row = tv ? tv.getFocusedItem() : null;
        if (!isAreaRow(row)) {
            return cb(null);
        }

        const fields = this.fields();
        if (0 === row.total) {
            //  msg_list would fail with "No messages in area" and bounce back
            this.setStatus(stringFormat(this.config.noMessagesText, fields, this.client));
            return cb(null);
        }

        this.readAreaTag = row.key;

        const failed = (menuName, err) => {
            this.client.log.warn(
                { menuName, areaTag: row.areaTag, error: err.message },
                'lampboard: cannot open the message list'
            );
            this.setStatus(
                stringFormat(this.config.menuUnavailableText, fields, this.client)
            );
        };

        if (row.isActivityPub) {
            //  as new_scan: the AP browser keeps no per-note read state, so
            //  the pointer moves to the newest message before handing off
            const menuName = this.config.activityPubListMenu;
            return messageArea().markMessageAreaRead(
                this.client.user,
                row.areaTag,
                err => {
                    if (err) {
                        //  as new_scan: open the browser anyway
                        this.client.log.warn(
                            { areaTag: row.areaTag, error: err.message },
                            'lampboard: cannot move the ActivityPub area pointer'
                        );
                    }
                    if (this.left) {
                        return cb(null);
                    }
                    this.gotoMenu(
                        menuName,
                        { extraArgs: { messageAreaTag: row.areaTag } },
                        err => {
                            if (err) {
                                failed(menuName, err);
                            }
                        }
                    );
                    return cb(null);
                }
            );
        }

        const menuName = this.config.messageListMenu;
        this.gotoMenu(
            menuName,
            {
                extraArgs: {
                    messageAreaTag: row.areaTag,
                    //  an area with nothing new opens at its newest message
                    //  (ignored by a core without the option)
                    focusWhenNoneNew: 'last',
                },
            },
            err => {
                if (err) {
                    failed(menuName, err);
                }
            }
        );
        return cb(null);
    }

    nextNew(cb) {
        const tv = this.table();
        if (!tv) {
            return cb(null);
        }
        const before = tv.focusedItemIndex;
        const index = tv.focusNextMatching(r => isAreaRow(r) && r.newCount > 0, {
            wrap: true,
        });
        if (-1 === index || index === before) {
            this.setStatus(
                stringFormat(this.config.noMoreNewText, this.fields(), this.client)
            );
        }
        return cb(null);
    }

    toggleScope(cb) {
        this.scope = Scopes.all === this.scope ? Scopes.newScan : Scopes.all;
        this.rebuild();
        this.applyRows({ keepFocus: true });
        this.setStatus(this.fields().scopeText);
        return cb(null);
    }

    toggleFilter(cb) {
        this.hideNoNew = !this.hideNoNew;
        this.rebuild();
        this.applyRows({ keepFocus: true });
        this.setStatus(this.fields().filterText);
        return cb(null);
    }

    cycleSort(cb) {
        const tv = this.table();
        if (!tv) {
            return cb(null);
        }
        const sortable = visibleSortable(tv.getConfig(), this.client.term.termWidth);
        const next = nextSortColumn(sortable, tv.getSort());
        tv.setSort(next);
        this.noteSortChange(tv);
        return cb(null);
    }

    toggleSortOrder(cb) {
        const tv = this.table();
        if (!tv) {
            return cb(null);
        }
        if (tv.getSort()) {
            tv.toggleSortOrder();
            this.noteSortChange(tv);
        } else {
            this.setStatus(this.sortText(tv));
        }
        return cb(null);
    }

    noteSortChange(tv) {
        this.sortChanged = true;
        this.userSort = normalizeSort(tv.getSort());
        this.updateInfo();
        this.setStatus(this.sortText(tv));
    }

    markRead(cb) {
        const tv = this.table();
        const row = tv ? tv.getFocusedItem() : null;
        if (!isAreaRow(row)) {
            return cb(null);
        }
        if (0 === row.newCount) {
            this.setStatus(
                stringFormat(this.config.noNewText, this.fields(), this.client)
            );
            return cb(null);
        }

        if (!this.config.confirmMarkRead) {
            this.doMarkRead(row);
            return cb(null);
        }

        const fields = this.fields();
        const question =
            stringFormat(this.config.markReadConfirmFormat, fields, this.client) +
            stringFormat(this.config.confirmSuffix, fields, this.client);
        this.confirm(question, yes => {
            if (yes) {
                return this.doMarkRead(row);
            }
            this.statusMessage = null;
            this.drawStatus();
        });
        return cb(null);
    }

    doMarkRead(row) {
        const ma = messageArea();
        const fields = this.fields();
        ma.markMessageAreaRead(this.client.user, row.areaTag, err => {
            if (this.left) {
                return;
            }
            if (err) {
                this.client.log.warn(
                    { areaTag: row.areaTag, error: err.message },
                    'lampboard: cannot mark area read'
                );
                return this.setStatus(`Error: ${err.message}`);
            }
            ma.getMessageAreaStats(this.client.user, [row.areaTag], (err, stats) => {
                if (this.left) {
                    return;
                }
                if (err) {
                    //  marked, but the new counts are unknown: say so rather
                    //  than show a row that may be wrong as "read"
                    this.client.log.warn(
                        { areaTag: row.areaTag, error: err.message },
                        'lampboard: marked read, but cannot re-read the area stats'
                    );
                    return this.setStatus(`Error: ${err.message}`);
                }
                if (stats && stats[row.areaTag]) {
                    this.stats[row.areaTag] = stats[row.areaTag];
                } else {
                    //  nothing back: count it as read
                    this.stats[row.areaTag] = Object.assign({}, this.stats[row.areaTag], {
                        newCount: 0,
                        yours: 0,
                    });
                }
                this.refreshRows();
                this.snapAfterChange();
                this.updateInfo();
                this.setStatus(
                    stringFormat(this.config.markedReadFormat, fields, this.client)
                );
            });
        });
    }

    //  the focused area has nothing new now: on to the next that has
    snapAfterChange() {
        const tv = this.table();
        if (!tv || !this.config.snapToNew) {
            return;
        }
        const focused = tv.getFocusedItem();
        if (isAreaRow(focused) && focused.newCount > 0) {
            return;
        }
        tv.focusNextMatching(r => isAreaRow(r) && r.newCount > 0, { wrap: true });
    }

    rescan(cb) {
        let confs;
        let selected;
        try {
            confs = this.listConfs();
            selected = messageArea().getNewScanMessageAreaTags(this.client);
        } catch (e) {
            this.setStatus(`Error: ${e.message}`);
            return cb(null);
        }
        const tags = [];
        confs.forEach(c => c.areas.forEach(a => tags.push(a.areaTag)));

        messageArea().getMessageAreaStats(this.client.user, tags, (err, stats) => {
            if (this.left) {
                return cb(null);
            }
            if (err) {
                this.client.log.warn({ error: err.message }, 'lampboard: re-scan failed');
                this.setStatus(`Error: ${err.message}`);
                return cb(null);
            }
            this.confs = confs;
            this.selected = selected;
            this.stats = stats || {};
            const changed = this.refreshRows();
            this.updateInfo();
            this.setStatus(
                stringFormat(this.config.rescanFormat, { changed }, this.client)
            );
            return cb(null);
        });
    }

    help(cb) {
        const vc = this.viewControllers[FormName];
        if (!vc) {
            return cb(null);
        }
        vc.setFocus(false);
        this.displayAsset(
            this.config.art.help,
            { clearScreen: true, trailingLF: false },
            err => {
                if (this.left) {
                    return;
                }
                if (err) {
                    this.client.log.warn(
                        { art: this.config.art.help, error: err.message },
                        'lampboard: cannot show the help art'
                    );
                    return this.redrawMain();
                }
                //  one key returns; our own listener (not waitForKeyPress())
                //  so that leave() can remove it
                this.removeHelpHandler();
                this.helpKeyHandler = () => {
                    this.removeHelpHandler();
                    if (!this.left) {
                        this.redrawMain();
                    }
                };
                this.client.on('key press', this.helpKeyHandler);
            }
        );
        return cb(null);
    }

    removeHelpHandler() {
        if (this.helpKeyHandler) {
            this.client.removeListener('key press', this.helpKeyHandler);
            this.helpKeyHandler = null;
        }
    }

    //  the index again, as it was (after help)
    redrawMain() {
        const vc = this.viewControllers[FormName];
        if (this.left || !vc) {
            return;
        }
        this.displayAsset(
            this.config.art.main,
            { clearScreen: true, trailingLF: false },
            () => {
                if (this.left) {
                    return;
                }
                vc.redrawAll();
                vc.setFocus(true);
                //  setFocus(false) dropped every view listener; setFocus(true)
                //  only puts back the form's own
                this.bindTableEvents();
                this.updateInfo();
            }
        );
    }

    //
    //  An inline y/N question in %TL2 (the WFC text prompt pattern): the
    //  form loses focus, one key answers, 'y' confirms.
    //
    confirm(question, cb) {
        const vc = this.viewControllers[FormName];
        vc.setFocus(false);
        this.removeConfirmHandler();

        const statusView = this.getView(FormName, MciViewIds.status);
        if (statusView) {
            this.statusMessage = question;
            statusView.setText(question);
        } else {
            const ansi = core('ansi_term.js');
            const row = this.client.term.termHeight || 24;
            this.client.term.rawWrite(
                `${ansi.goto(row, 1)}${ansi.eraseLine()}${core(
                    'color_codes.js'
                ).pipeToAnsi(question, this.client)}`
            );
        }

        this.confirmHandler = ch => {
            this.removeConfirmHandler();
            if (!statusView) {
                const ansi = core('ansi_term.js');
                this.client.term.rawWrite(
                    `${ansi.goto(this.client.term.termHeight || 24, 1)}${ansi.eraseLine()}`
                );
            }
            vc.setFocus(true);
            this.bindTableEvents();
            return cb('string' === typeof ch && 'y' === ch.toLowerCase());
        };
        this.client.on('key press', this.confirmHandler);
    }

    removeConfirmHandler() {
        if (this.confirmHandler) {
            this.client.removeListener('key press', this.confirmHandler);
            this.confirmHandler = null;
        }
    }
};
