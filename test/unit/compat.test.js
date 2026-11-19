'use strict';

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const compat = require('../../lib/compat.js');

function fakeCore(overrides = {}) {
    function TableView() {}
    compat.TableViewMethods.forEach(m => {
        TableView.prototype[m] = () => {};
    });
    function MenuModule() {}
    MenuModule.prototype.getDefaultCustomInfoFormats = () => ({});

    const messageArea = {};
    compat.MessageAreaFunctions.forEach(f => {
        messageArea[f] = () => {};
    });

    const files = {
        'core/message_area.js': messageArea,
        'core/mci_view_factory.js': { MCIViewFactory: { UserViewCodes: ['VM', 'TV'] } },
        'core/table_view.js': { TableView },
        'core/module_util.js': { getModArtPath: () => {} },
        'core/menu_module.js': { MenuModule },
        'package.json': { version: '0.6.1-beta' },
    };
    Object.assign(files, overrides);

    return relPath => {
        const mod = files[relPath];
        if (mod instanceof Error) {
            throw mod;
        }
        if (undefined === mod) {
            throw new Error(`Cannot find module '${relPath}'`);
        }
        return mod;
    };
}

describe('compat: checkCore()', () => {
    afterEach(() => compat._resetCompat());

    it('everything present: ok, no warnings, version read', () => {
        const r = compat.checkCore(fakeCore());
        assert.deepEqual(r, {
            ok: true,
            missing: [],
            warnings: [],
            version: '0.6.1-beta',
        });
    });

    it('no stats API: not ok', () => {
        const r = compat.checkCore(
            fakeCore({ 'core/message_area.js': { getMessageAreaStats: () => {} } })
        );
        assert.equal(r.ok, false);
        assert.deepEqual(r.missing, [compat.Feature.stats]);
    });

    it('no %TV registration: not ok', () => {
        const r = compat.checkCore(
            fakeCore({
                'core/mci_view_factory.js': { MCIViewFactory: { UserViewCodes: ['VM'] } },
            })
        );
        assert.equal(r.ok, false);
        assert.deepEqual(r.missing, [compat.Feature.tableView]);
    });

    it('a TableView without a method lampboard needs: not ok', () => {
        function TableView() {}
        TableView.prototype.setDefaults = () => {};
        const r = compat.checkCore(fakeCore({ 'core/table_view.js': { TableView } }));
        assert.deepEqual(r.missing, [compat.Feature.tableView]);
    });

    it('no table_view.js at all (0.6.0): not ok, no throw', () => {
        const r = compat.checkCore(
            fakeCore({
                'core/table_view.js': undefined,
                'package.json': { version: '0.6.0' },
            })
        );
        assert.equal(r.ok, false);
        assert.equal(r.version, '0.6.0');
        assert.match(compat.describeFailure(r), /ENiGMA½ 0\.6\.0 lacks TableView/);
        assert.match(compat.describeFailure(r), /needs 0\.6\.1-beta or later/);
    });

    it('a require that throws: not ok, no throw', () => {
        const r = compat.checkCore(
            fakeCore({ 'core/message_area.js': new Error('boom at load') })
        );
        assert.equal(r.ok, false);
        assert.ok(r.missing.includes(compat.Feature.stats));
    });

    it('a loader that throws for everything: not ok, no throw', () => {
        const r = compat.checkCore(() => {
            throw new Error('nothing here');
        });
        assert.equal(r.ok, false);
        assert.equal(r.missing.length, 2);
        assert.equal(r.warnings.length, 2);
        assert.equal(r.version, null);
    });

    it('no mod art fallback: a warning only', () => {
        const r = compat.checkCore(fakeCore({ 'core/module_util.js': {} }));
        assert.equal(r.ok, true);
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /mod art fallback/);
    });

    it('no getDefaultCustomInfoFormats (#1128): a warning only', () => {
        function MenuModule() {}
        const r = compat.checkCore(fakeCore({ 'core/menu_module.js': { MenuModule } }));
        assert.equal(r.ok, true);
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /info formats/);
    });

    it('getCompat() caches', () => {
        let calls = 0;
        const load = fakeCore();
        const counting = p => {
            calls += 1;
            return load(p);
        };
        const a = compat.getCompat(counting);
        const n = calls;
        const b = compat.getCompat(counting);
        assert.equal(a, b);
        assert.equal(calls, n);
    });
});
