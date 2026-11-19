'use strict';

//
//  Feature detection against the ENiGMA½ core lampboard is loaded into.
//  There is no mod API yet, so lampboard checks for the pieces it uses
//  instead of gating on a version number (betas, forks and git checkouts
//  all carry versions that say little). The version is read for logging
//  only.
//
//  checkCore(load) -> { ok, missing: [], warnings: [], version }
//
//  |load(relPath)| requires a file relative to the ENiGMA root, e.g.
//  load('core/message_area.js'), and may throw (an old core lacks the file,
//  or the file itself throws). Nothing here throws.
//

//  message_area.js functions lampboard calls
const MessageAreaFunctions = [
    'getMessageAreaStats',
    'markMessageAreaRead',
    'getNewScanMessageAreaTags',
    'getSortedAvailMessageConferences',
    'getSortedAvailMessageAreasByConfTag',
];

//  TableView methods lampboard calls
const TableViewMethods = [
    'setDefaults',
    'updateItem',
    'focusNextMatching',
    'setSort',
    'getSort',
    'getConfig',
];

//  what a failed check names in the log line
const Feature = {
    stats: 'getMessageAreaStats',
    tableView: 'TableView (%TV)',
    modArt: 'mod art fallback',
    infoFormats: 'default custom info formats',
};

const MinimumCoreText = '0.6.1-beta';

function tryLoad(load, relPath) {
    try {
        return { mod: load(relPath) };
    } catch (e) {
        return { error: e };
    }
}

function isFunction(v) {
    return 'function' === typeof v;
}

function checkCore(load) {
    const result = { ok: true, missing: [], warnings: [], version: null };
    const miss = what => {
        if (!result.missing.includes(what)) {
            result.missing.push(what);
        }
    };

    //  A: the stats API and the area helpers
    const messageArea = tryLoad(load, 'core/message_area.js').mod;
    if (!messageArea || !MessageAreaFunctions.every(f => isFunction(messageArea[f]))) {
        miss(Feature.stats);
    }

    //  B: TableView, registered as %TV, with the methods used
    const factory = tryLoad(load, 'core/mci_view_factory.js').mod;
    const codes =
        factory && factory.MCIViewFactory && factory.MCIViewFactory.UserViewCodes;
    const tableView = tryLoad(load, 'core/table_view.js').mod;
    const proto =
        tableView && tableView.TableView && tableView.TableView.prototype
            ? tableView.TableView.prototype
            : null;
    if (
        !Array.isArray(codes) ||
        !codes.includes('TV') ||
        !proto ||
        !TableViewMethods.every(m => isFunction(proto[m]))
    ) {
        miss(Feature.tableView);
    }

    //  F: the mod art fallback (optional: art can be copied into the theme)
    const moduleUtil = tryLoad(load, 'core/module_util.js').mod;
    if (!moduleUtil || !isFunction(moduleUtil.getModArtPath)) {
        result.warnings.push(
            `no ${Feature.modArt}: copy mods/lampboard/art/* into your theme or art/general`
        );
    }

    //  MenuModule.getDefaultCustomInfoFormats() (optional: without it the
    //  %TL10+ views show only what the operator configures)
    const menuModule = tryLoad(load, 'core/menu_module.js').mod;
    const menuProto =
        menuModule && menuModule.MenuModule && menuModule.MenuModule.prototype;
    if (!menuProto || !isFunction(menuProto.getDefaultCustomInfoFormats)) {
        result.warnings.push(
            `no ${Feature.infoFormats}: %TL10+ views show only formats set in config (mainInfoFormat10...)`
        );
    }

    const pkg = tryLoad(load, 'package.json').mod;
    result.version = pkg && 'string' === typeof pkg.version ? pkg.version : null;

    result.ok = 0 === result.missing.length;
    return result;
}

//  The boot log line for a failed check
function describeFailure(result) {
    const version = result.version ? ` ${result.version}` : '';
    return (
        `lampboard: ENiGMA½${version} lacks ${result.missing.join(', ')}; ` +
        `lampboard needs ${MinimumCoreText} or later. Menus using it send callers on.`
    );
}

let cached;

//  checkCore(), once per process
function getCompat(load) {
    if (!cached) {
        cached = checkCore(load);
    }
    return cached;
}

//  tests only
function _resetCompat() {
    cached = undefined;
}

module.exports = {
    MessageAreaFunctions,
    TableViewMethods,
    Feature,
    MinimumCoreText,
    checkCore,
    describeFailure,
    getCompat,
    _resetCompat,
};
