'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    pickFocusIndex,
    nextNewIndex,
    nearestAreaIndex,
    visibleSortable,
    nextSortColumn,
    normalizeSavedState,
    describeSort,
} = require('../../lib/nav.js');
const { TableDefaults } = require('../../lib/defaults.js');

const g = key => ({ kind: 'group', key });
const a = (key, newCount = 0) => ({ key, newCount });

//  0:g 1:a 2:b(new) 3:g 4:c 5:d(new)
const Items = () => [g('@conf:1'), a('a'), a('b', 3), g('@conf:2'), a('c'), a('d', 1)];

describe('nav: focus', () => {
    it('first entry: the first area with new messages', () => {
        assert.equal(pickFocusIndex(Items(), { snapToNew: true }), 2);
    });

    it('first entry without snapToNew: the first area', () => {
        assert.equal(pickFocusIndex(Items(), { snapToNew: false }), 1);
    });

    it('first entry, nothing new: the first area (never a group row)', () => {
        const items = [g('@conf:1'), a('a'), a('b')];
        assert.equal(pickFocusIndex(items, { snapToNew: true }), 1);
    });

    it('no area rows at all: -1', () => {
        assert.equal(pickFocusIndex([], {}), -1);
        assert.equal(pickFocusIndex([g('@conf:1')], {}), -1);
    });

    it('return: the same area when it still has new messages', () => {
        assert.equal(pickFocusIndex(Items(), { focusKey: 'b', snapToNew: true }), 2);
    });

    it('return: the next new area (wrapping) when the area read is now empty', () => {
        assert.equal(pickFocusIndex(Items(), { focusKey: 'c', snapToNew: true }), 5);
        const items = Items();
        items[5].newCount = 0; //  only b has new: wrap round to it from d
        assert.equal(pickFocusIndex(items, { focusKey: 'd', snapToNew: true }), 2);
    });

    it('return: stays put when nothing anywhere is new', () => {
        const items = [g('@conf:1'), a('a'), a('b'), a('c')];
        assert.equal(pickFocusIndex(items, { focusKey: 'b', snapToNew: true }), 2);
    });

    it('return without snapToNew: the same area even when empty', () => {
        assert.equal(pickFocusIndex(Items(), { focusKey: 'c', snapToNew: false }), 4);
    });

    it('return: a row that is gone falls to the nearest area, then snaps', () => {
        const items = [g('@conf:1'), a('a'), a('b'), g('@conf:2'), a('d')];
        //  was at index 3 (now a group row): nearest area is 4 (ties go down)
        assert.equal(
            pickFocusIndex(items, { focusKey: 'gone', focusIndex: 3, snapToNew: false }),
            4
        );
        //  past the end: clamped to the last area
        assert.equal(
            pickFocusIndex(items, { focusKey: 'gone', focusIndex: 99, snapToNew: false }),
            4
        );
    });

    it('nextNewIndex(): wraps; returns |from| when it is the only match; -1 when none', () => {
        assert.equal(nextNewIndex(Items(), 2), 5);
        assert.equal(nextNewIndex(Items(), 5), 2);
        const one = [g('x'), a('a', 1), a('b')];
        assert.equal(nextNewIndex(one, 1), 1);
        assert.equal(nextNewIndex([a('a'), a('b')], 0), -1);
    });

    it('nearestAreaIndex()', () => {
        assert.equal(nearestAreaIndex(Items(), 0), 1);
        assert.equal(nearestAreaIndex(Items(), 3), 4);
        assert.equal(nearestAreaIndex([], 3), -1);
    });
});

describe('nav: sort cycle', () => {
    it('board order -> each sortable column -> board order', () => {
        const sortable = ['area', 'new', 'yours'];
        let sort = null;
        const seen = [];
        for (let i = 0; i < 5; ++i) {
            const next = nextSortColumn(sortable, sort);
            seen.push(next);
            sort = next ? { column: next, order: 'asc' } : null;
        }
        assert.deepEqual(seen, ['area', 'new', 'yours', null, 'area']);
    });

    it('a column not in the cycle (e.g. a theme sort) restarts it', () => {
        assert.equal(nextSortColumn(['area', 'new'], { column: 'total' }), 'area');
    });

    it('nothing sortable: board order', () => {
        assert.equal(nextSortColumn([], { column: 'area' }), null);
    });

    it('visibleSortable() skips columns hidden by minTermWidth or columnOrder', () => {
        assert.deepEqual(visibleSortable(TableDefaults, 80), [
            'area',
            'new',
            'yours',
            'total',
            'last',
        ]);
        //  last hides below 64 columns
        assert.deepEqual(visibleSortable(TableDefaults, 60), [
            'area',
            'new',
            'yours',
            'total',
        ]);
        const cfg = Object.assign({}, TableDefaults, { columnOrder: ['area', 'new'] });
        assert.deepEqual(visibleSortable(cfg, 80), ['area', 'new']);
    });

    it('visibleSortable() without sortable: every visible column', () => {
        const cfg = Object.assign({}, TableDefaults, { sortable: undefined });
        assert.deepEqual(visibleSortable(cfg, 80), TableDefaults.columnOrder);
    });

    it('describeSort()', () => {
        const texts = {
            moduleOrderText: 'board order',
            sortAscText: 'ascending',
            sortDescText: 'descending',
        };
        assert.deepEqual(describeSort(null, TableDefaults, texts), {
            sortLabel: 'board order',
            sortOrderText: '',
        });
        assert.deepEqual(
            describeSort({ column: 'new', order: 'desc' }, TableDefaults, texts),
            {
                sortLabel: 'New',
                sortOrderText: 'descending',
            }
        );
        assert.deepEqual(
            describeSort({ column: 'flag', order: 'asc' }, TableDefaults, texts),
            {
                sortLabel: 'flag',
                sortOrderText: 'ascending',
            }
        );
    });
});

describe('nav: saved state', () => {
    it('keeps known, well-formed fields', () => {
        assert.deepEqual(
            normalizeSavedState({
                scope: 'all',
                hideNoNew: true,
                sortChanged: true,
                userSort: { column: 'new', order: 'desc' },
                focusKey: 'fsx_gen',
                focusIndex: 4,
                readAreaTag: 'fsx_gen',
            }),
            {
                scope: 'all',
                hideNoNew: true,
                sortChanged: true,
                userSort: { column: 'new', order: 'desc' },
                focusKey: 'fsx_gen',
                focusIndex: 4,
                readAreaTag: 'fsx_gen',
            }
        );
    });

    it('a user return to board order (userSort null) is kept', () => {
        assert.deepEqual(normalizeSavedState({ sortChanged: true, userSort: null }), {
            sortChanged: true,
            userSort: null,
        });
    });

    it('drops unknown and malformed fields', () => {
        assert.deepEqual(
            normalizeSavedState({
                scope: 'everything',
                hideNoNew: 'yes',
                sortChanged: true,
                userSort: { order: 'desc' },
                focusKey: 7,
                focusIndex: -1,
                readAreaTag: '',
                futureField: 1,
            }),
            {}
        );
        assert.deepEqual(normalizeSavedState(null), {});
        assert.deepEqual(normalizeSavedState('x'), {});
    });

    it('userSort without sortChanged is ignored', () => {
        assert.deepEqual(normalizeSavedState({ userSort: { column: 'new' } }), {});
    });

    it('a bad order becomes asc', () => {
        assert.deepEqual(
            normalizeSavedState({
                sortChanged: true,
                userSort: { column: 'new', order: 'x' },
            }).userSort,
            { column: 'new', order: 'asc' }
        );
    });
});
