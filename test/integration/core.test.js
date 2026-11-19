'use strict';

//  lampboard against a real core: feature check, module smoke, render

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const paths = require('path');

const H = require('./harness.js');

const skip = H.skipReason();

describe('integration: core', { skip }, () => {
    let compat;
    let defaults;
    let rows;
    let TableView;
    let logSink;

    before(() => {
        ({ logSink } = H.installCore());
        compat = require('../../lib/compat.js');
        defaults = require('../../lib/defaults.js');
        rows = require('../../lib/rows.js');
        TableView = H.enigma('core/table_view.js').TableView;
    });

    after(() => {
        H.restoreCore();
    });

    it('checkCore() against this core: ok, no warnings', () => {
        const result = compat.checkCore(rel => require(paths.join(H.EnigmaRoot, rel)));
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.warnings, []);
        assert.equal(result.ok, true);
        assert.equal(typeof result.version, 'string');
    });

    it('lampboard.js loads and exports what ENiGMA needs', () => {
        const mod = require('../../lampboard.js');
        assert.equal(mod.moduleInfo.packageName, 'codes.l33t.enigma.lampboard');
        assert.equal(mod.moduleInfo.name, 'lampboard');
        assert.equal(typeof mod.getModule, 'function');
        assert.equal(typeof mod.moduleInitialize, 'function');
        const { MenuModule } = H.enigma('core/menu_module.js');
        assert.ok(mod.getModule.prototype instanceof MenuModule);
    });

    it('moduleInitialize() never fails the boot', (t, done) => {
        const mod = require('../../lampboard.js');
        mod.moduleInitialize({}, err => {
            assert.equal(err, null);
            //  one info line when all is well (operators see it at the
            //  default level); no warnings on this core
            const ours = logSink.filter(e => /^lampboard:/.test(String(e.args[1])));
            assert.deepEqual(
                ours.map(e => [e.level, e.args[1]]),
                [['info', 'lampboard: ready (core features found)']]
            );
            done();
        });
    });

    describe('render', () => {
        function render(termWidth, extra = {}) {
            const client = new H.FakeClient({ termWidth });
            const tv = new TableView({
                client,
                id: 1,
                position: { row: 1, col: 1 },
                dimens: { width: termWidth, height: 12 },
            });
            tv.setDefaults(defaults.tableDefaults());
            tv.setDefaults(extra);
            const { rows: built } = rows.buildRows(
                [
                    {
                        confTag: 'fsxnet',
                        conf: { name: 'fsxNet' },
                        areas: [
                            { areaTag: 'fsx_gen', area: { name: 'General' } },
                            { areaTag: 'fsx_bbs', area: { name: 'BBS Talk' } },
                        ],
                    },
                ],
                {
                    fsx_gen: {
                        total: 1234,
                        newCount: 5,
                        yours: 0,
                        lastPostId: 9,
                        lastPostTs: '2026-11-18T10:00:00.000Z',
                    },
                    fsx_bbs: {
                        total: 3,
                        newCount: 0,
                        yours: 0,
                        lastPostId: 3,
                        lastPostTs: null,
                    },
                },
                { scope: 'all', newIndicator: 'NEW' }
            );
            tv.setItems(built);
            tv.redraw();
            const screen = [];
            for (let r = 1; r <= 4; ++r) {
                screen.push(H.drawnOnRow(client.writes, r));
            }
            return screen;
        }

        it('draws the header, the group divider, NEW and "-" for zero', () => {
            const [header, group, gen, bbs] = render(80);
            assert.match(header, /Area/);
            assert.match(header, /Total/);
            assert.match(header, /New/);
            assert.match(header, /Yours/);
            assert.match(header, /Last Post/);
            assert.match(group, /───── fsxNet ─+/);
            assert.match(gen, /^NEW/);
            assert.match(gen, /General/);
            assert.match(gen, /1,234/);
            assert.match(gen, /18 Nov 26/);
            assert.doesNotMatch(bbs, /NEW/);
            assert.match(bbs, /BBS Talk/);
            //  New and Yours are both 0: drawn as '-'
            assert.match(bbs, /│\s+-\s+│\s+-\s+│/);
            assert.match(bbs, /never/);
        });

        it('hides the Last Post column at 60 columns', () => {
            const [header, , gen] = render(60);
            assert.doesNotMatch(header, /Last Post/);
            assert.doesNotMatch(gen, /18 Nov 26/);
            assert.match(header, /Yours/);
        });

        it('an operator sort (theme mci) re-orders within the group', () => {
            const [, , first, second] = render(80, {});
            assert.match(first, /General/);
            assert.match(second, /BBS Talk/);
            //  explicit menu/theme values sit above setDefaults(); emulate
            //  an area sort ascending: BBS Talk before General
            const client = new H.FakeClient({ termWidth: 80 });
            const tv = new TableView({
                client,
                id: 1,
                position: { row: 1, col: 1 },
                dimens: { width: 80, height: 8 },
                sort: { column: 'area', order: 'asc' },
            });
            tv.setDefaults(defaults.tableDefaults());
            tv.setItems([
                { kind: 'group', key: '@conf:x', confName: 'X' },
                { key: 'b', areaName: 'Zed', newCount: 0, total: 1, yours: 0 },
                { key: 'a', areaName: 'Alpha', newCount: 0, total: 1, yours: 0 },
            ]);
            assert.deepEqual(
                tv.getItems().map(r => r.key),
                ['@conf:x', 'a', 'b']
            );
        });
    });

    it('the shipped art parses to the MCI layout lampboard expects', (t, done) => {
        const fs = require('fs');
        const { ANSIEscapeParser } = H.enigma('core/ansi_escape_parser.js');
        const data = H.enigma('node_modules/iconv-lite').decode(
            fs.readFileSync(paths.join(H.RepoRoot, 'art', 'LAMPBRD.ANS')),
            'cp437'
        );
        //  the parser art.display() uses, with its MCI map keying
        const parser = new ANSIEscapeParser({
            mciReplaceChar: ' ',
            termHeight: 25,
            termWidth: 80,
            trailingLF: false,
        });
        const map = {};
        parser.on('mci', info => {
            map[`${info.mci}${info.id}`] = info.position;
        });
        parser.on('complete', () => {
            assert.deepEqual(Object.keys(map).sort(), [
                'TL10',
                'TL11',
                'TL12',
                'TL2',
                'TL3',
                'TV1',
            ]);
            assert.deepEqual(map.TV1, [3, 1]);
            assert.deepEqual(map.TL3, [20, 2]);
            assert.deepEqual(map.TL10, [21, 2]);
            assert.deepEqual(map.TL11, [21, 41]);
            assert.deepEqual(map.TL12, [22, 2]);
            assert.deepEqual(map.TL2, [23, 2]);
            done();
        });
        parser.reset(data);
        parser.parse();
    });
});
