'use strict';

//
//  TableView rows for the index: one group row per conference with visible
//  areas, then its area rows. Pure: no ENiGMA imports, no lodash, so it can
//  be unit tested without a BBS.
//
//  |confs| is board order, as the message area list shows it:
//    [ { confTag, conf: { name, desc }, areas: [ { areaTag, area: { name,
//      desc, addressFlavor } } ] } ]
//  |stats| is getMessageAreaStats()'s result:
//    { [areaTag]: { total, newCount, yours, lastPostId, lastPostTs } }
//

//  as core's message_const.SystemInternalConfTags (private mail, bulletins)
const SystemInternalConfTags = Object.freeze(['system_internal']);

const GroupKeyPrefix = '@conf:';

function groupKey(confTag) {
    return `${GroupKeyPrefix}${confTag}`;
}

function isGroupRow(row) {
    return !!row && 'group' === row.kind;
}

function isAreaRow(row) {
    return !!row && 'object' === typeof row && 'group' !== row.kind;
}

//  A Date for a stored timestamp (ISO 8601 string, epoch ms or Date); null
//  when there is none or it does not parse
function toDate(v) {
    if (v instanceof Date) {
        return isNaN(v.getTime()) ? null : v;
    }
    if (('string' === typeof v && '' !== v) || 'number' === typeof v) {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function toCount(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

//  'personal' (new mail to the caller) > 'new' > null
function rowState(newCount, yours) {
    if (yours > 0) {
        return 'personal';
    }
    return newCount > 0 ? 'new' : null;
}

//  The fields of an area row that come from its stats
function areaFields(stats, newIndicator) {
    stats = stats || {};
    const newCount = toCount(stats.newCount);
    const yours = toCount(stats.yours);
    return {
        total: toCount(stats.total),
        newCount,
        yours,
        lastPostId: toCount(stats.lastPostId),
        lastPostTs: toDate(stats.lastPostTs),
        newIndicator:
            newCount > 0 && 'string' === typeof newIndicator ? newIndicator : '',
        state: rowState(newCount, yours),
    };
}

//  The fields of a group row summed over its visible |areaRows|
function groupFields(areaRows) {
    let newCount = 0;
    let yours = 0;
    let newAreaCount = 0;
    let anyPersonal = false;
    areaRows.forEach(r => {
        newCount += r.newCount;
        yours += r.yours;
        if (r.newCount > 0) {
            newAreaCount += 1;
        }
        if ('personal' === r.state) {
            anyPersonal = true;
        }
    });
    return {
        areaCount: areaRows.length,
        newAreaCount,
        newCount,
        yours,
        state: anyPersonal ? 'personal' : newAreaCount > 0 ? 'new' : null,
    };
}

//  System Internal first, everything else in the order given (stable)
function pinConfs(confs, pinTags = SystemInternalConfTags) {
    const pinned = confs.filter(c => pinTags.includes(c.confTag));
    const rest = confs.filter(c => !pinTags.includes(c.confTag));
    return pinned.concat(rest);
}

function toSet(v) {
    if (v instanceof Set) {
        return v;
    }
    return Array.isArray(v) ? new Set(v) : null;
}

//
//  options:
//    scope         'newscan': only |selected| areas; 'all': every area given
//    selected      the new scan areas (array or Set); null/undefined = all
//    omit          area tags never shown (omitMessageAreaTags)
//    hideNoNew     leave out areas with nothing new (and empty conferences)
//    newIndicator  {newIndicator} text for rows with new messages
//
//  -> { rows, totals }
//    totals.areaCount       area rows shown
//    totals.newAreaCount    of those, areas with new messages
//    totals.totalNew        new messages over the scope
//    totals.totalYours      new messages to the caller over the scope
//    totals.scopeAreaCount  areas in scope before hideNoNew
//    totals.confCount       group rows shown
//
function buildRows(confs, stats, options = {}) {
    stats = stats || {};
    const scope = 'all' === options.scope ? 'all' : 'newscan';
    const selected = 'newscan' === scope ? toSet(options.selected) : null;
    const omit = new Set(Array.isArray(options.omit) ? options.omit : []);
    const hideNoNew = !!options.hideNoNew;

    const rows = [];
    const totals = {
        areaCount: 0,
        newAreaCount: 0,
        totalNew: 0,
        totalYours: 0,
        scopeAreaCount: 0,
        confCount: 0,
    };

    pinConfs(Array.isArray(confs) ? confs : []).forEach(c => {
        const conf = c.conf || {};
        const confName = conf.name || c.confTag;
        const confDesc = conf.desc || '';

        const areaRows = (c.areas || [])
            .filter(a => a && a.areaTag && !omit.has(a.areaTag))
            .filter(a => !selected || selected.has(a.areaTag))
            .map(a => {
                const area = a.area || {};
                return Object.assign(
                    {
                        key: a.areaTag,
                        data: a.areaTag,
                        areaTag: a.areaTag,
                        areaName: area.name || a.areaTag,
                        areaDesc: area.desc || '',
                        confTag: c.confTag,
                        confName,
                        confDesc,
                        isActivityPub: 'activitypub' === area.addressFlavor,
                    },
                    areaFields(stats[a.areaTag], options.newIndicator)
                );
            });

        totals.scopeAreaCount += areaRows.length;
        areaRows.forEach(r => {
            totals.totalNew += r.newCount;
            totals.totalYours += r.yours;
        });

        const visible = hideNoNew ? areaRows.filter(r => r.newCount > 0) : areaRows;
        if (0 === visible.length) {
            return; //  no group row for an empty conference
        }

        rows.push(
            Object.assign(
                {
                    kind: 'group',
                    key: groupKey(c.confTag),
                    confTag: c.confTag,
                    confName,
                    confDesc,
                },
                groupFields(visible)
            )
        );
        rows.push(...visible);

        totals.confCount += 1;
        totals.areaCount += visible.length;
        totals.newAreaCount += visible.filter(r => r.newCount > 0).length;
    });

    return { rows, totals };
}

function sameValue(a, b) {
    if (a instanceof Date || b instanceof Date) {
        const ta = a instanceof Date ? a.getTime() : a;
        const tb = b instanceof Date ? b.getTime() : b;
        return ta === tb;
    }
    return a === b;
}

//  The fields of |next| that differ from |prev| (key and kind aside), or
//  null when nothing does: what updateItem() needs to redraw one row
function rowPatch(prev, next) {
    if (!prev || !next) {
        return next ? Object.assign({}, next) : null;
    }
    const patch = {};
    let changed = false;
    Object.keys(next).forEach(k => {
        if ('key' === k || 'kind' === k) {
            return;
        }
        if (!sameValue(prev[k], next[k])) {
            patch[k] = next[k];
            changed = true;
        }
    });
    return changed ? patch : null;
}

//  The row keys, in order
function rowKeys(rows) {
    return (rows || []).map(r => r && r.key);
}

//
//  Fields for the format strings (areaDescFormat, statusIdleFormat,
//  mainInfoFormat10+...): the focused area's, plus the summary.
//
//  ctx: { scope, scopeText, filterText, sortText, neverText,
//         formatDate(date) -> string }
//
function infoFields(row, totals, ctx = {}) {
    totals = totals || {};
    const area = isAreaRow(row) ? row : null;
    const formatDate =
        'function' === typeof ctx.formatDate ? ctx.formatDate : d => d.toISOString();
    const lastPostTs = area ? area.lastPostTs || null : null;
    return {
        areaTag: area ? area.areaTag : '',
        areaName: area ? area.areaName : '',
        areaDesc: area ? area.areaDesc : '',
        confTag: area ? area.confTag : '',
        confName: area ? area.confName : '',
        confDesc: area ? area.confDesc : '',
        total: area ? area.total : 0,
        newCount: area ? area.newCount : 0,
        yours: area ? area.yours : 0,
        lastPostTs,
        lastPost: lastPostTs ? formatDate(lastPostTs) : area ? ctx.neverText || '' : '',
        newIndicator: area ? area.newIndicator : '',

        areaCount: totals.areaCount || 0,
        newAreaCount: totals.newAreaCount || 0,
        totalNew: totals.totalNew || 0,
        totalYours: totals.totalYours || 0,
        scope: ctx.scope || 'newscan',
        scopeText: ctx.scopeText || '',
        filterText: ctx.filterText || '',
        sortText: ctx.sortText || '',
    };
}

module.exports = {
    SystemInternalConfTags,
    GroupKeyPrefix,
    groupKey,
    isGroupRow,
    isAreaRow,
    toDate,
    rowState,
    areaFields,
    groupFields,
    pinConfs,
    buildRows,
    rowPatch,
    rowKeys,
    infoFields,
};
