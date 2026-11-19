'use strict';

//
//  Focus, sort-cycle and saved-state helpers. Pure: they work on plain row
//  arrays in screen order (TableView.getItems()) and plain config objects.
//

const { isAreaRow } = require('./rows.js');

function hasNew(row) {
    return isAreaRow(row) && row.newCount > 0;
}

function firstAreaIndex(items) {
    return (items || []).findIndex(isAreaRow);
}

function firstNewIndex(items) {
    return (items || []).findIndex(hasNew);
}

//  The next area row with new messages after |from|, wrapping; |from| itself
//  only when it is the one match. -1 when there is none.
function nextNewIndex(items, from) {
    items = items || [];
    const count = items.length;
    for (let step = 1; step <= count; ++step) {
        const i = (((from + step) % count) + count) % count;
        if (hasNew(items[i])) {
            return i;
        }
    }
    return -1;
}

//  The area row nearest to |index| (the next one on a tie); -1 when none
function nearestAreaIndex(items, index) {
    items = items || [];
    if (!items.length) {
        return -1;
    }
    index = Math.min(Math.max(index || 0, 0), items.length - 1);
    for (let d = 0; d < items.length; ++d) {
        if (isAreaRow(items[index + d])) {
            return index + d;
        }
        if (d > 0 && isAreaRow(items[index - d])) {
            return index - d;
        }
    }
    return -1;
}

//
//  Where focus goes once rows are (re)built.
//
//  First entry (no |focusKey|): the first area with new messages when
//  |snapToNew|, else the first area.
//  Return from reading: the area read (|focusKey|), or the row nearest to
//  where it was (|focusIndex|) when it is gone; then, when |snapToNew| and
//  that area has nothing new now, the next area that has (wrapping).
//
//  -> an index into |items|, or -1 when there is no area row at all
//
function pickFocusIndex(items, { focusKey, focusIndex, snapToNew = true } = {}) {
    items = items || [];
    const first = firstAreaIndex(items);
    if (-1 === first) {
        return -1;
    }

    const restoring = undefined !== focusKey && null !== focusKey;
    if (!restoring) {
        if (snapToNew) {
            const n = firstNewIndex(items);
            if (n > -1) {
                return n;
            }
        }
        return first;
    }

    let at = items.findIndex(r => isAreaRow(r) && r.key === focusKey);
    if (-1 === at) {
        at = nearestAreaIndex(items, Number.isInteger(focusIndex) ? focusIndex : 0);
    }
    if (snapToNew && !hasNew(items[at])) {
        const n = nextNewIndex(items, at);
        if (n > -1) {
            return n;
        }
    }
    return at;
}

//
//  The columns the sort cycle visits: config.sortable (else every column in
//  columnOrder), less those not shown (left out of columnOrder, or hidden
//  below their minTermWidth). Mirrors TableView.cycleSort().
//
function visibleSortable(tableConfig, termWidth) {
    tableConfig = tableConfig || {};
    const columns = tableConfig.columns || {};
    const order = Array.isArray(tableConfig.columnOrder)
        ? tableConfig.columnOrder
        : Object.keys(columns);
    const visible = new Set(
        order.filter(id => {
            const col = columns[id];
            return col && !(col.minTermWidth > termWidth);
        })
    );
    const sortable = Array.isArray(tableConfig.sortable) ? tableConfig.sortable : order;
    return sortable.filter(id => visible.has(id));
}

//
//  The sort cycle: board order -> sortable[0] -> ... -> last -> board order.
//  |current| is TableView.getSort() (null: board order). -> the next
//  column, or null for board order.
//
function nextSortColumn(sortable, current) {
    sortable = Array.isArray(sortable) ? sortable : [];
    if (!sortable.length) {
        return null;
    }
    const column = current && current.column;
    if (!column) {
        return sortable[0];
    }
    const at = sortable.indexOf(column);
    if (-1 === at) {
        return sortable[0];
    }
    return at + 1 < sortable.length ? sortable[at + 1] : null;
}

function normalizeSort(sort) {
    if (null === sort) {
        return null;
    }
    if (!sort || 'object' !== typeof sort || 'string' !== typeof sort.column) {
        return undefined;
    }
    return { column: sort.column, order: 'desc' === sort.order ? 'desc' : 'asc' };
}

//
//  A saved state (getSaveState()) read back with anything unknown or
//  malformed dropped, so a state saved by another version cannot break the
//  screen.
//
//  -> { scope, hideNoNew, sortChanged, userSort, focusKey, focusIndex,
//       readAreaTag } (each may be undefined)
//
function normalizeSavedState(raw) {
    const out = {};
    if (!raw || 'object' !== typeof raw) {
        return out;
    }
    if ('newscan' === raw.scope || 'all' === raw.scope) {
        out.scope = raw.scope;
    }
    if ('boolean' === typeof raw.hideNoNew) {
        out.hideNoNew = raw.hideNoNew;
    }
    if (true === raw.sortChanged) {
        const sort = normalizeSort(raw.userSort);
        if (undefined !== sort) {
            out.sortChanged = true;
            out.userSort = sort;
        }
    }
    if ('string' === typeof raw.focusKey && raw.focusKey) {
        out.focusKey = raw.focusKey;
    }
    if (Number.isInteger(raw.focusIndex) && raw.focusIndex >= 0) {
        out.focusIndex = raw.focusIndex;
    }
    if ('string' === typeof raw.readAreaTag && raw.readAreaTag) {
        out.readAreaTag = raw.readAreaTag;
    }
    return out;
}

//  { sortLabel, sortOrderText } for config.sortFormat
function describeSort(sort, tableConfig, texts = {}) {
    if (!sort || !sort.column) {
        return { sortLabel: texts.moduleOrderText || '', sortOrderText: '' };
    }
    const col = ((tableConfig || {}).columns || {})[sort.column] || {};
    return {
        sortLabel: col.label || sort.column,
        sortOrderText:
            'desc' === sort.order ? texts.sortDescText || '' : texts.sortAscText || '',
    };
}

module.exports = {
    hasNew,
    firstAreaIndex,
    firstNewIndex,
    nextNewIndex,
    nearestAreaIndex,
    pickFocusIndex,
    visibleSortable,
    nextSortColumn,
    normalizeSort,
    normalizeSavedState,
    describeSort,
};
