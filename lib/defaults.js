'use strict';

//
//  lampboard's defaults, in code (the coinmarket pattern): operators
//  override them in the menu's `config` and `mci.TV1` blocks, or in
//  theme.hjson `customization.menus.<menu>`. Pure: no ENiGMA imports.
//

//  Menu `config` keys. Every key lampboard reads has a default here.
const ConfigDefaults = Object.freeze({
    art: Object.freeze({
        main: 'LAMPBRD',
        help: 'LAMPBRDHLP',
    }),
    messageListMenu: 'newScanMessageList',
    activityPubListMenu: 'newScanActivityPubList',
    initialScope: 'newscan', //  'newscan' | 'all'
    hideNoNew: false,
    omitMessageAreaTags: Object.freeze([]),
    snapToNew: true,
    confirmMarkRead: true,
    newIndicator: 'NEW',
    //  undefined: the theme's (MenuModule.getDateTimeFormat())
    dateTimeFormat: undefined,
    neverText: 'never',
    //  {lastPostLine}: empty when no area is focused
    lastPostLineFormat: '|08Last post |07{lastPost}',
    areaDescFormat: '{areaDesc}',
    statusIdleFormat: '{newAreaCount} of {areaCount} areas have new messages',
    noNewText: 'No new messages',
    noMoreNewText: 'No other areas with new messages',
    noMessagesText: '{areaName} has no messages',
    markReadConfirmFormat: 'Mark {areaName} read?',
    confirmSuffix: ' |08[|15y|08/|15N|08] ',
    markedReadFormat: 'Marked {areaName} read',
    rescanFormat: 'Re-scanned: {changed} area(s) changed',
    scopeNewScanText: 'Your new scan areas',
    scopeAllText: 'All areas',
    filterOnText: 'Only areas with new messages',
    filterOffText: 'All areas shown',
    sortFormat: 'Sorted by {sortLabel} {sortOrderText}',
    sortAscText: 'ascending',
    sortDescText: 'descending',
    moduleOrderText: 'board order',
    emptyText: '|08No message areas to show',
    emptyNoNewText: '|08No new messages',
    unsupportedTerminalText: 'The message index needs an ANSI terminal.',
    unsupportedCoreText: 'The message index is not available right now.',
    menuUnavailableText: 'That area cannot be opened right now.',
});

//
//  Defaults for the %TL10+ custom range of form 'main' (mainInfoFormat10,
//  ...), handed to core through MenuModule.getDefaultCustomInfoFormats().
//  Anything the operator sets for the same ID wins, including an empty
//  string or null, which hide the view.
//
const InfoFormatDefaults = Object.freeze({
    10: '{lastPostLine}',
    11: '|07{sortText}',
    12: '|07{scopeText}|08, |07{filterText}',
});

//
//  TableView layout, handed to tv.setDefaults(). Layering:
//    view built-ins < these < menu mci.TV1 < theme.hjson mci.TV1
//  columns, stateSGR, sort, group and sortIndicator deep-merge; arrays
//  (rules, sort.then, columnOrder, sortable) replace.
//
//  No `sort`: rows stay in board order (System Internal first, then
//  conferences and areas by their configured sort/name).
//
const TableDefaults = Object.freeze({
    header: true,
    headerSGR: '|00|15',
    separator: ' |08│ ',
    focusSGR: '|00|17',
    sortable: ['area', 'new', 'yours', 'total', 'last'],
    columnOrder: ['flag', 'area', 'total', 'new', 'yours', 'last'],
    columns: {
        flag: { field: 'newIndicator', width: 3, sgr: '|15' },
        area: { field: 'areaName', label: 'Area', width: 'fill', textOverflow: '..' },
        total: {
            field: 'total',
            label: 'Total',
            type: 'number',
            width: 6,
            format: '{value:,}',
            sgr: '|03',
            sortOrder: 'desc',
        },
        new: {
            field: 'newCount',
            label: 'New',
            type: 'number',
            width: 5,
            sgr: '|08',
            sortOrder: 'desc',
            rules: [
                { when: '> 0', sgr: '|10' },
                { when: '= 0', text: '-' },
            ],
        },
        yours: {
            field: 'yours',
            label: 'Yours',
            type: 'number',
            width: 5,
            sgr: '|08',
            sortOrder: 'desc',
            rules: [
                { when: '> 0', sgr: '|13' },
                { when: '= 0', text: '-' },
            ],
        },
        last: {
            field: 'lastPostTs',
            label: 'Last Post',
            type: 'date',
            dateFormat: 'DD MMM YY',
            width: 9,
            nullText: '|08never',
            minTermWidth: 64,
            sortOrder: 'desc',
        },
    },
    group: { format: '|08───── |15{confName} ', fillChar: '|08─' },
    stateSGR: { new: '|15', personal: '|11' },
    //  emptyText is set at load time from config.emptyText / emptyNoNewText
});

const Scopes = Object.freeze({ newScan: 'newscan', all: 'all' });

function isPlainObject(v) {
    if (null === v || 'object' !== typeof v) {
        return false;
    }
    const proto = Object.getPrototypeOf(v);
    return null === proto || Object.prototype === proto;
}

//  A deep copy of plain objects and arrays; anything else as is
function clone(v) {
    if (Array.isArray(v)) {
        return v.map(clone);
    }
    if (isPlainObject(v)) {
        const out = {};
        Object.keys(v).forEach(k => {
            out[k] = clone(v[k]);
        });
        return out;
    }
    return v;
}

//  |over| onto a copy of |base|: plain objects merge, arrays and every other
//  value replace, undefined is skipped. Neither input is touched.
function deepMerge(base, over) {
    const out = clone(base);
    if (!isPlainObject(over)) {
        return out;
    }
    Object.keys(over).forEach(k => {
        const v = over[k];
        if (undefined === v) {
            return;
        }
        out[k] =
            isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : clone(v);
    });
    return out;
}

//
//  The menu's config over ConfigDefaults, as a new object. |menuConfig| is
//  the shared, cached theme object (every session using the menu sees it),
//  so it is never written to.
//
function mergeDefaults(menuConfig) {
    const merged = deepMerge(ConfigDefaults, menuConfig);

    //  a bad value falls back rather than break the screen
    if (!Object.values(Scopes).includes(merged.initialScope)) {
        merged.initialScope = ConfigDefaults.initialScope;
    }
    if (!isPlainObject(merged.art)) {
        merged.art = clone(ConfigDefaults.art);
    }
    ['main', 'help'].forEach(name => {
        if ('string' !== typeof merged.art[name] || !merged.art[name]) {
            merged.art[name] = ConfigDefaults.art[name];
        }
    });
    merged.omitMessageAreaTags = Array.isArray(merged.omitMessageAreaTags)
        ? merged.omitMessageAreaTags
        : 'string' === typeof merged.omitMessageAreaTags
          ? [merged.omitMessageAreaTags]
          : [];
    ['hideNoNew', 'snapToNew', 'confirmMarkRead'].forEach(k => {
        merged[k] = !!merged[k];
    });

    return merged;
}

//  A fresh copy of TableDefaults (setDefaults() keeps what it is given)
function tableDefaults() {
    return clone(TableDefaults);
}

//  The %TL10+ defaults for |formName| as a new object
function infoFormatDefaults(formName) {
    return 'main' === formName ? Object.assign({}, InfoFormatDefaults) : {};
}

module.exports = {
    ConfigDefaults,
    InfoFormatDefaults,
    TableDefaults,
    Scopes,
    isPlainObject,
    clone,
    deepMerge,
    mergeDefaults,
    tableDefaults,
    infoFormatDefaults,
};
