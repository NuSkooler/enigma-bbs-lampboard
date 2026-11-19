'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildRows,
    areaFields,
    groupFields,
    rowPatch,
    infoFields,
    toDate,
    groupKey,
} = require('../../lib/rows.js');

function conf(confTag, name, areas) {
    return {
        confTag,
        conf: { name, desc: `${name} desc` },
        areas: areas.map(a =>
            'string' === typeof a
                ? { areaTag: a, area: { name: a.toUpperCase(), desc: `${a} desc` } }
                : a
        ),
    };
}

const Confs = () => [
    conf('fsxnet', 'fsxNet', ['fsx_gen', 'fsx_bbs']),
    conf('local', 'Local', ['local_gen']),
    conf('system_internal', 'System Internal', ['private_mail', 'local_bulletin']),
    conf('activitypub_internal', 'ActivityPub', [
        {
            areaTag: 'activitypub_shared',
            area: { name: 'Fediverse', addressFlavor: 'activitypub' },
        },
    ]),
];

const Stats = () => ({
    fsx_gen: {
        total: 100,
        newCount: 5,
        yours: 0,
        lastPostId: 900,
        lastPostTs: '2026-11-18T10:00:00.000-07:00',
    },
    fsx_bbs: { total: 10, newCount: 0, yours: 0, lastPostId: 50, lastPostTs: null },
    local_gen: {
        total: 3,
        newCount: 2,
        yours: 1,
        lastPostId: 70,
        lastPostTs: '2026-11-17T09:00:00.000Z',
    },
    private_mail: {
        total: 4,
        newCount: 1,
        yours: 1,
        lastPostId: 80,
        lastPostTs: '2026-11-16T09:00:00.000Z',
    },
    local_bulletin: { total: 0, newCount: 0, yours: 0, lastPostId: 0, lastPostTs: null },
    activitypub_shared: {
        total: 7,
        newCount: 0,
        yours: 0,
        lastPostId: 60,
        lastPostTs: '2026-11-15T09:00:00.000Z',
    },
});

const keys = rows => rows.map(r => r.key);

describe('rows: buildRows()', () => {
    it('groups areas per conference with System Internal pinned first', () => {
        const { rows } = buildRows(Confs(), Stats(), { scope: 'all' });
        assert.deepEqual(keys(rows), [
            '@conf:system_internal',
            'private_mail',
            'local_bulletin',
            '@conf:fsxnet',
            'fsx_gen',
            'fsx_bbs',
            '@conf:local',
            'local_gen',
            '@conf:activitypub_internal',
            'activitypub_shared',
        ]);
        assert.equal(rows[0].kind, 'group');
        assert.equal(rows[0].confName, 'System Internal');
        assert.equal(rows[1].kind, undefined);
    });

    it('newscan scope keeps only the selected areas; all keeps everything', () => {
        const selected = ['fsx_gen', 'private_mail'];
        const ns = buildRows(Confs(), Stats(), { scope: 'newscan', selected });
        assert.deepEqual(keys(ns.rows), [
            '@conf:system_internal',
            'private_mail',
            '@conf:fsxnet',
            'fsx_gen',
        ]);
        const all = buildRows(Confs(), Stats(), { scope: 'all', selected });
        assert.equal(all.totals.areaCount, 6);
    });

    it('a missing selection (null) in newscan scope means every area', () => {
        const { totals } = buildRows(Confs(), Stats(), {
            scope: 'newscan',
            selected: null,
        });
        assert.equal(totals.areaCount, 6);
    });

    it('accepts the selection as a Set', () => {
        const { totals } = buildRows(Confs(), Stats(), {
            scope: 'newscan',
            selected: new Set(['local_gen']),
        });
        assert.equal(totals.areaCount, 1);
    });

    it('omit drops areas in both scopes', () => {
        const omit = ['activitypub_shared', 'fsx_bbs'];
        ['all', 'newscan'].forEach(scope => {
            const { rows } = buildRows(Confs(), Stats(), { scope, omit });
            assert.ok(!keys(rows).includes('activitypub_shared'));
            assert.ok(!keys(rows).includes('fsx_bbs'));
            //  its conference had nothing else: no group row
            assert.ok(!keys(rows).includes('@conf:activitypub_internal'));
        });
    });

    it('hideNoNew drops areas with nothing new and empty conferences', () => {
        const { rows, totals } = buildRows(Confs(), Stats(), {
            scope: 'all',
            hideNoNew: true,
        });
        assert.deepEqual(keys(rows), [
            '@conf:system_internal',
            'private_mail',
            '@conf:fsxnet',
            'fsx_gen',
            '@conf:local',
            'local_gen',
        ]);
        assert.equal(totals.areaCount, 3);
        assert.equal(totals.scopeAreaCount, 6);
    });

    it('hideNoNew with nothing new leaves no rows but keeps scopeAreaCount', () => {
        const stats = Stats();
        Object.values(stats).forEach(s => {
            s.newCount = 0;
            s.yours = 0;
        });
        const { rows, totals } = buildRows(Confs(), stats, {
            scope: 'all',
            hideNoNew: true,
        });
        assert.equal(rows.length, 0);
        assert.equal(totals.scopeAreaCount, 6);
        assert.equal(totals.totalNew, 0);
    });

    it('row and conference state: personal > new > null', () => {
        const { rows } = buildRows(Confs(), Stats(), { scope: 'all' });
        const by = Object.fromEntries(rows.map(r => [r.key, r]));
        assert.equal(by.fsx_gen.state, 'new');
        assert.equal(by.fsx_bbs.state, null);
        assert.equal(by.local_gen.state, 'personal');
        assert.equal(by.private_mail.state, 'personal');
        assert.equal(by['@conf:fsxnet'].state, 'new');
        assert.equal(by['@conf:local'].state, 'personal');
        assert.equal(by['@conf:activitypub_internal'].state, null);
    });

    it('group rows carry sums over their visible areas', () => {
        const { rows } = buildRows(Confs(), Stats(), { scope: 'all' });
        const g = rows.find(r => r.key === '@conf:fsxnet');
        assert.equal(g.areaCount, 2);
        assert.equal(g.newAreaCount, 1);
        assert.equal(g.newCount, 5);
        assert.equal(g.yours, 0);
    });

    it('newIndicator only on rows with new messages', () => {
        const { rows } = buildRows(Confs(), Stats(), {
            scope: 'all',
            newIndicator: 'NEW',
        });
        const by = Object.fromEntries(rows.map(r => [r.key, r]));
        assert.equal(by.fsx_gen.newIndicator, 'NEW');
        assert.equal(by.fsx_bbs.newIndicator, '');
    });

    it('lastPostTs becomes a Date, null-safe', () => {
        const { rows } = buildRows(Confs(), Stats(), { scope: 'all' });
        const by = Object.fromEntries(rows.map(r => [r.key, r]));
        assert.ok(by.fsx_gen.lastPostTs instanceof Date);
        assert.equal(by.fsx_gen.lastPostTs.toISOString(), '2026-11-18T17:00:00.000Z');
        assert.equal(by.fsx_bbs.lastPostTs, null);
    });

    it('flags ActivityPub areas', () => {
        const { rows } = buildRows(Confs(), Stats(), { scope: 'all' });
        const by = Object.fromEntries(rows.map(r => [r.key, r]));
        assert.equal(by.activitypub_shared.isActivityPub, true);
        assert.equal(by.fsx_gen.isActivityPub, false);
    });

    it('area rows carry key, data and the conference', () => {
        const { rows } = buildRows(Confs(), Stats(), { scope: 'all' });
        const r = rows.find(x => x.key === 'fsx_gen');
        assert.equal(r.data, 'fsx_gen');
        assert.equal(r.areaName, 'FSX_GEN');
        assert.equal(r.areaDesc, 'fsx_gen desc');
        assert.equal(r.confTag, 'fsxnet');
        assert.equal(r.confName, 'fsxNet');
    });

    it('totals', () => {
        const { totals } = buildRows(Confs(), Stats(), { scope: 'all' });
        assert.deepEqual(totals, {
            areaCount: 6,
            newAreaCount: 3,
            totalNew: 8,
            totalYours: 2,
            scopeAreaCount: 6,
            confCount: 4,
        });
    });

    it('areas without stats count as empty', () => {
        const { rows } = buildRows(Confs(), {}, { scope: 'all' });
        const r = rows.find(x => x.key === 'fsx_gen');
        assert.equal(r.total, 0);
        assert.equal(r.newCount, 0);
        assert.equal(r.lastPostTs, null);
    });

    it('copes with no input', () => {
        assert.deepEqual(buildRows(undefined, undefined).rows, []);
    });
});

describe('rows: helpers', () => {
    it('toDate()', () => {
        assert.equal(toDate(null), null);
        assert.equal(toDate(''), null);
        assert.equal(toDate('not a date'), null);
        assert.ok(toDate('2026-11-18T10:00:00Z') instanceof Date);
        assert.ok(toDate(0) instanceof Date);
    });

    it('areaFields() clamps junk counts to 0', () => {
        const f = areaFields({ total: -1, newCount: 'x', yours: null }, 'NEW');
        assert.equal(f.total, 0);
        assert.equal(f.newCount, 0);
        assert.equal(f.yours, 0);
        assert.equal(f.newIndicator, '');
        assert.equal(f.state, null);
    });

    it('groupFields() of no rows', () => {
        assert.deepEqual(groupFields([]), {
            areaCount: 0,
            newAreaCount: 0,
            newCount: 0,
            yours: 0,
            state: null,
        });
    });

    it('groupKey()', () => {
        assert.equal(groupKey('x'), '@conf:x');
    });

    it('rowPatch(): only changed fields, Dates by value, key/kind ignored', () => {
        const a = { key: 'k', newCount: 1, lastPostTs: new Date(1000), total: 3 };
        const b = { key: 'k', newCount: 0, lastPostTs: new Date(1000), total: 3 };
        assert.deepEqual(rowPatch(a, b), { newCount: 0 });
        assert.equal(rowPatch(a, Object.assign({}, a)), null);
        assert.deepEqual(
            rowPatch(a, Object.assign({}, a, { lastPostTs: new Date(2000) })),
            {
                lastPostTs: new Date(2000),
            }
        );
    });

    it('infoFields(): area and summary fields', () => {
        const { rows, totals } = buildRows(Confs(), Stats(), { scope: 'all' });
        const row = rows.find(r => r.key === 'fsx_gen');
        const f = infoFields(row, totals, {
            scope: 'all',
            scopeText: 'All areas',
            filterText: 'All areas shown',
            sortText: 'Sorted by board order',
            neverText: 'never',
            formatDate: () => 'DATE',
        });
        assert.equal(f.areaName, 'FSX_GEN');
        assert.equal(f.lastPost, 'DATE');
        assert.equal(f.newCount, 5);
        assert.equal(f.areaCount, 6);
        assert.equal(f.newAreaCount, 3);
        assert.equal(f.totalNew, 8);
        assert.equal(f.scope, 'all');
        assert.equal(f.scopeText, 'All areas');

        const never = infoFields(
            rows.find(r => r.key === 'fsx_bbs'),
            totals,
            { neverText: 'never' }
        );
        assert.equal(never.lastPost, 'never');

        const none = infoFields(null, totals, {});
        assert.equal(none.areaName, '');
        assert.equal(none.lastPost, '');
        assert.equal(none.areaCount, 6);

        //  a group row is not an area
        assert.equal(infoFields(rows[0], totals, {}).areaName, '');
    });
});

describe('rows: lastPostLine', () => {
    const ctx = {
        neverText: 'never',
        lastPostLineFormat: '|08Last post |07{lastPost}',
        formatDate: () => 'DATE',
    };
    const area = { key: 'a', areaName: 'A', lastPostTs: new Date(0) };

    it('the format with {lastPost} for a focused area', () => {
        assert.equal(infoFields(area, {}, ctx).lastPostLine, '|08Last post |07DATE');
        assert.equal(
            infoFields(Object.assign({}, area, { lastPostTs: null }), {}, ctx)
                .lastPostLine,
            '|08Last post |07never'
        );
    });

    it('empty with no focused area (empty table, group row)', () => {
        assert.equal(infoFields(null, {}, ctx).lastPostLine, '');
        assert.equal(
            infoFields({ kind: 'group', key: '@conf:x' }, {}, ctx).lastPostLine,
            ''
        );
    });

    it('uses ctx.format when given; empty format means empty', () => {
        const f = infoFields(
            area,
            {},
            Object.assign({}, ctx, { format: () => 'FORMATTED' })
        );
        assert.equal(f.lastPostLine, 'FORMATTED');
        assert.equal(
            infoFields(area, {}, Object.assign({}, ctx, { lastPostLineFormat: '' }))
                .lastPostLine,
            ''
        );
    });
});
