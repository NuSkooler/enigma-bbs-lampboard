'use strict';

//
//  The lampboard module driven end to end on a real core: real
//  ViewController, TableView and TextViews, real conference/area listing
//  (from a test config) and real menu actions. Stubbed: the art loader (a
//  fixed MCI map in the shipped layout), the two message DB calls, and the
//  menu stack (calls are recorded).
//

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const H = require('./harness.js');

const skip = H.skipReason();

//  as LAMPBRD.ANS lays them out
function mciMap({ withTable = true } = {}) {
    const entry = (code, id, row, col) => ({
        position: [row, col],
        args: [],
        SGR: '',
        code,
        id,
    });
    const map = {
        TL2: entry('TL', 2, 23, 2),
        TL3: entry('TL', 3, 20, 2),
        TL10: entry('TL', 10, 21, 2),
        TL11: entry('TL', 11, 21, 41),
        TL12: entry('TL', 12, 22, 2),
    };
    if (withTable) {
        map.TV1 = entry('TV', 1, 3, 1);
    }
    return map;
}

function freshStats() {
    return {
        private_mail: {
            total: 2,
            newCount: 1,
            yours: 1,
            lastPostId: 50,
            lastPostTs: null,
        },
        local_bulletin: {
            total: 0,
            newCount: 0,
            yours: 0,
            lastPostId: 0,
            lastPostTs: null,
        },
        local_general: {
            total: 10,
            newCount: 0,
            yours: 0,
            lastPostId: 10,
            lastPostTs: '2026-11-10T12:00:00.000Z',
        },
        local_empty: { total: 0, newCount: 0, yours: 0, lastPostId: 0, lastPostTs: null },
        fsx_gen: {
            total: 100,
            newCount: 5,
            yours: 0,
            lastPostId: 900,
            lastPostTs: '2026-11-18T12:00:00.000Z',
        },
        fsx_bbs: { total: 20, newCount: 0, yours: 0, lastPostId: 300, lastPostTs: null },
        fsx_mystic: {
            total: 7,
            newCount: 2,
            yours: 1,
            lastPostId: 400,
            lastPostTs: null,
        },
        activitypub_shared: {
            total: 4,
            newCount: 3,
            yours: 0,
            lastPostId: 70,
            lastPostTs: null,
        },
    };
}

function noneNew() {
    const s = freshStats();
    Object.values(s).forEach(v => {
        v.newCount = 0;
        v.yours = 0;
    });
    return s;
}

const settle = async (n = 5) => {
    for (let i = 0; i < n; ++i) {
        await new Promise(r => setImmediate(r));
    }
};

describe('integration: lampboard module', { skip }, () => {
    let Lampboard;
    let messageArea;
    let UserProps;
    const saved = {};
    let db; //  the stub message DB: { stats, markCalls, statsCalls }

    before(() => {
        H.installCore();
        messageArea = H.enigma('core/message_area.js');
        UserProps = H.enigma('core/user_property.js');

        saved.getMessageAreaStats = messageArea.getMessageAreaStats;
        saved.markMessageAreaRead = messageArea.markMessageAreaRead;
        saved.swapped = true;
        messageArea.getMessageAreaStats = (user, tags, cb) => {
            db.statsCalls.push(tags.slice());
            if (db.statsCalls.length > db.failStatsAfter) {
                return cb(new Error('stats unavailable'));
            }
            const out = {};
            tags.forEach(t => {
                if (db.stats[t]) {
                    out[t] = Object.assign({}, db.stats[t]);
                }
            });
            return cb(null, out);
        };
        messageArea.markMessageAreaRead = (user, tag, cb) => {
            db.markCalls.push(tag);
            if (db.markError) {
                return cb(db.markError);
            }
            if (db.stats[tag]) {
                db.stats[tag].newCount = 0;
                db.stats[tag].yours = 0;
            }
            return cb(null);
        };

        Lampboard = require('../../lampboard.js').getModule;
    });

    after(() => {
        if (saved.swapped) {
            messageArea.getMessageAreaStats = saved.getMessageAreaStats;
            messageArea.markMessageAreaRead = saved.markMessageAreaRead;
        }
        H.restoreCore();
    });

    beforeEach(() => {
        db = {
            stats: freshStats(),
            markCalls: [],
            statsCalls: [],
            failStatsAfter: Infinity,
            markError: null,
        };
    });

    //  An instance of |menuName| as menu_stack would create it, with the art
    //  loader stubbed; |art| records each art name drawn
    function create(menuName = 'lampboardMain', opts = {}) {
        const menus = H.loadMenus();
        const menuConfig = menus[menuName];
        if (opts.config) {
            Object.assign(menuConfig.config, opts.config);
        }
        const client = opts.client || new H.FakeClient(opts.clientOpts);
        const inst = new Lampboard({
            menuName,
            menuConfig,
            client,
            extraArgs: undefined,
            lastMenuResult: opts.lastMenuResult,
        });
        inst.artDrawn = [];
        inst.displayAsset = (name, options, cb) => {
            inst.artDrawn.push(name);
            if (opts.artError) {
                return cb(new Error('no such art'));
            }
            return cb(null, { mciMap: mciMap(opts.mci), height: 24 });
        };
        inst.pausePrompt = (pos, cb) => (cb || pos)(null);
        if (opts.savedState) {
            inst.restoreSavedState(opts.savedState);
        }
        client.currentMenuModule = inst;
        return { inst, client, menuConfig };
    }

    async function enter(menuName, opts) {
        const made = create(menuName, opts);
        made.inst.enter();
        await settle();
        return made;
    }

    const tv = inst => inst.table();
    const focusedKey = inst => {
        const row = tv(inst).getFocusedItem();
        return row ? row.key : null;
    };
    //  Every table row on screen shows the row TableView holds at that
    //  index (header on row 3, body from row 4)
    const assertScreenMatchesRows = (inst, client) => {
        tv(inst)
            .getItems()
            .forEach((r, i) => {
                const shown = H.drawnOnRow(client.writes, 4 + i);
                const name = 'group' === r.kind ? r.confName : r.areaName;
                assert.ok(
                    shown && shown.includes(name),
                    `row ${4 + i} shows ${JSON.stringify(shown)}, expected ${name}`
                );
            });
    };
    const text = (inst, id) => {
        const v = inst.getView('main', id);
        return v ? H.visible(v.getData()) : null;
    };

    it('main entry: draws the index and focuses the first area with new mail', async () => {
        const { inst, client } = await enter('lampboardMain');
        assert.deepEqual(inst.artDrawn, ['LAMPBRD']);
        const keys = tv(inst)
            .getItems()
            .map(r => r.key);
        //  System Internal first, then board order (sort), hidden AP conference included
        assert.deepEqual(keys.slice(0, 10), [
            '@conf:system_internal',
            'private_mail',
            'local_bulletin',
            '@conf:local',
            'local_general',
            'local_empty',
            '@conf:fsxnet',
            'fsx_gen',
            'fsx_bbs',
            'fsx_mystic',
        ]);
        assert.ok(keys.includes('activitypub_shared'));
        assert.equal(focusedKey(inst), 'private_mail');
        assert.equal(text(inst, 2), '4 of 8 areas have new messages');
        assert.equal(text(inst, 3), 'Private user to user mail');
        //  %TL10+ module defaults (MenuModule.getDefaultCustomInfoFormats)
        assert.equal(text(inst, 10), 'Last post never');
        assert.equal(text(inst, 11), 'Sorted by board order');
        assert.equal(text(inst, 12), 'Your new scan areas, All areas shown');
        //  one stats query over every readable area
        assert.equal(db.statsCalls.length, 1);
        assert.equal(db.statsCalls[0].length, 8);
        //  the table really drew
        assert.ok(client.writes.join('').includes('Private Mail'));
        assert.deepEqual(client.menuStack.calls, []);
    });

    it('never writes to the shared menu config', async () => {
        const { inst, client, menuConfig } = create('lampboardMain', {
            config: { newIndicator: '*' },
        });
        const before = JSON.stringify(menuConfig);
        inst.enter();
        await settle();
        client.press('n');
        client.press('v');
        client.press('s');
        await settle();
        assert.equal(JSON.stringify(menuConfig), before);
        assert.equal(inst.config.art.main, 'LAMPBRD');
        assert.equal(menuConfig.config.art, undefined);
    });

    it('an operator info format wins; null hides the view', async () => {
        const { inst } = await enter('lampboardMain', {
            config: { mainInfoFormat10: '|07{areaName}!', mainInfoFormat11: null },
        });
        assert.equal(text(inst, 10), 'Private Mail!');
        assert.equal(text(inst, 11), '');
    });

    it('n: next area with new messages, then "no other" when it runs out', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('n');
        assert.equal(focusedKey(inst), 'fsx_gen');
        assert.equal(text(inst, 3), 'General chat');
        client.press('n');
        assert.equal(focusedKey(inst), 'fsx_mystic');
        client.press('tab', 'tab');
        assert.equal(focusedKey(inst), 'activitypub_shared');
        client.press('n');
        assert.equal(focusedKey(inst), 'private_mail'); //  wraps
    });

    it('n with only the focused area new: says so and stays', async () => {
        db.stats = noneNew();
        db.stats.fsx_gen.newCount = 1;
        const { inst, client } = await enter('lampboardMain');
        assert.equal(focusedKey(inst), 'fsx_gen');
        client.press('n');
        assert.equal(focusedKey(inst), 'fsx_gen');
        assert.equal(text(inst, 2), 'No other areas with new messages');
    });

    it('main entry with nothing new: the table with zero counts and "No new messages"', async () => {
        db.stats = noneNew();
        const { inst, client } = await enter('lampboardMain');
        assert.equal(inst.artDrawn.length, 1);
        assert.equal(focusedKey(inst), 'private_mail'); //  first area
        assert.equal(text(inst, 2), 'No new messages');
        assert.deepEqual(client.menuStack.calls, []);
    });

    it('v: new scan areas <-> all areas, keeping focus', async () => {
        const props = {
            [UserProps.NewScanAreaTags]: JSON.stringify(['fsx_gen', 'local_general']),
        };
        const { inst, client } = await enter('lampboardMain', { clientOpts: { props } });
        let keys = tv(inst)
            .getItems()
            .map(r => r.key);
        assert.deepEqual(keys, [
            '@conf:local',
            'local_general',
            '@conf:fsxnet',
            'fsx_gen',
        ]);
        assert.equal(focusedKey(inst), 'fsx_gen');
        client.press('v');
        keys = tv(inst)
            .getItems()
            .map(r => r.key);
        assert.ok(keys.includes('fsx_mystic'));
        assert.equal(focusedKey(inst), 'fsx_gen');
        assert.equal(text(inst, 2), 'All areas');
        assert.equal(text(inst, 12), 'All areas, All areas shown');
        //  no new query
        assert.equal(db.statsCalls.length, 1);
        client.press('V', 'shift + v');
        assert.equal(text(inst, 2), 'Your new scan areas');
    });

    it('f: only areas with new messages; empty conferences go too', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('f');
        const keys = tv(inst)
            .getItems()
            .map(r => r.key);
        assert.ok(!keys.includes('@conf:local'));
        assert.ok(!keys.includes('fsx_bbs'));
        assert.ok(keys.includes('fsx_gen'));
        assert.equal(text(inst, 2), 'Only areas with new messages');
    });

    it('hideNoNew with nothing new shows emptyNoNewText', async () => {
        db.stats = noneNew();
        const { inst, client } = await enter('lampboardMain', {
            config: { hideNoNew: true },
        });
        assert.equal(tv(inst).getItems().length, 0);
        assert.ok(H.visible(client.writes.join('')).includes('No new messages'));
    });

    it('m + y: marks the area read, redraws it, snaps on; keys still work after', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('n'); //  fsx_gen
        client.press('m');
        assert.match(text(inst, 2), /^Mark fsxNet General read\? \[y\/N\]/);
        //  the form is not listening while the question is up
        client.press('n');
        //  'n' answered the question (no): nothing marked, focus unchanged
        assert.deepEqual(db.markCalls, []);
        assert.equal(focusedKey(inst), 'fsx_gen');

        client.press('m');
        client.press('y');
        await settle();
        assert.deepEqual(db.markCalls, ['fsx_gen']);
        const row = tv(inst)
            .getItems()
            .find(r => r.key === 'fsx_gen');
        assert.equal(row.newCount, 0);
        assert.equal(row.newIndicator, '');
        const group = tv(inst)
            .getItems()
            .find(r => r.key === '@conf:fsxnet');
        assert.equal(group.newCount, 2);
        //  snapped to the next area with new mail
        assert.equal(focusedKey(inst), 'fsx_mystic');
        assert.equal(text(inst, 2), 'Marked fsxNet General read');

        //  the table's listeners survived the prompt: TL3 follows focus
        client.press('n');
        assert.equal(focusedKey(inst), 'activitypub_shared');
        assert.equal(text(inst, 3), 'Public posts');
    });

    it('m with confirmMarkRead false marks at once; m on an area with nothing new does nothing', async () => {
        const { inst, client } = await enter('lampboardMain', {
            config: { confirmMarkRead: false },
        });
        client.press('m');
        await settle();
        assert.deepEqual(db.markCalls, ['private_mail']);
        assert.equal(focusedKey(inst), 'fsx_gen');

        client.press('', 'up arrow');
        client.press('', 'up arrow');
        assert.equal(focusedKey(inst), 'local_general');
        client.press('m');
        await settle();
        assert.deepEqual(db.markCalls, ['private_mail']);
    });

    it('m with hideNoNew: the read area drops out', async () => {
        const { inst, client } = await enter('lampboardMain', {
            config: { hideNoNew: true, confirmMarkRead: false },
        });
        assert.equal(focusedKey(inst), 'private_mail');
        client.press('m');
        await settle();
        const keys = tv(inst)
            .getItems()
            .map(r => r.key);
        assert.ok(!keys.includes('private_mail'));
        assert.ok(!keys.includes('@conf:system_internal'));
        assert.equal(focusedKey(inst), 'fsx_gen');
    });

    it('return: opens the message list with the area and focusWhenNoneNew', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('n'); //  fsx_gen
        client.press('\r', 'return');
        await settle();
        const gotos = client.menuStack.calls.filter(c => 'goto' === c[0]);
        assert.equal(gotos.length, 1);
        assert.equal(gotos[0][1], 'newScanMessageList');
        assert.deepEqual(gotos[0][2], {
            extraArgs: { messageAreaTag: 'fsx_gen', focusWhenNoneNew: 'last' },
        });
        assert.equal(inst.getSaveState().readAreaTag, 'fsx_gen');
    });

    it('return on an ActivityPub area: marks it read, then the AP list', async () => {
        const { client } = await enter('lampboardMain');
        client.press('n');
        client.press('n');
        client.press('n'); //  activitypub_shared
        client.press('\r', 'return');
        await settle();
        assert.deepEqual(db.markCalls, ['activitypub_shared']);
        const gotos = client.menuStack.calls.filter(c => 'goto' === c[0]);
        assert.equal(gotos[0][1], 'newScanActivityPubList');
        assert.deepEqual(gotos[0][2], {
            extraArgs: { messageAreaTag: 'activitypub_shared' },
        });
    });

    it('return on an empty area: a status line, no navigation', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('', 'down arrow'); //  local_bulletin (total 0)
        assert.equal(focusedKey(inst), 'local_bulletin');
        client.press('\r', 'return');
        await settle();
        assert.deepEqual(client.menuStack.calls, []);
        assert.equal(text(inst, 2), 'System Bulletins has no messages');
    });

    it('return when the menu cannot be opened: a status line', async () => {
        const client = new H.FakeClient();
        client.menuStack.gotoError = new Error('No such menu');
        const { inst } = await enter('lampboardMain', { client });
        client.press('\r', 'return');
        await settle();
        assert.equal(text(inst, 2), 'That area cannot be opened right now.');
    });

    it('coming back from reading: a rebuild, then focus snaps past the area read', async () => {
        const first = await enter('lampboardMain');
        first.client.press('n'); //  fsx_gen
        first.client.press('v');
        first.client.press('s'); //  area sort
        first.client.press('\r', 'return');
        await settle();
        const state = first.inst.getSaveState();
        assert.equal(state.readAreaTag, 'fsx_gen');
        assert.equal(state.scope, 'all');
        assert.deepEqual(state.userSort, { column: 'area', order: 'asc' });

        //  the caller read everything in fsx_gen
        db.stats.fsx_gen.newCount = 0;

        const back = await enter('lampboardMain', { savedState: state });
        assert.equal(back.inst.scope, 'all');
        assert.deepEqual(tv(back.inst).getSort(), {
            column: 'area',
            order: 'asc',
            then: [],
        });
        const row = tv(back.inst)
            .getItems()
            .find(r => r.key === 'fsx_gen');
        assert.equal(row.newCount, 0);
        //  sorted by area name within fsxNet: BBS Discussion, fsxNet General, Mystic
        assert.equal(focusedKey(back.inst), 'fsx_mystic');
    });

    it('coming back with the area still new: focus stays on it', async () => {
        const back = await enter('lampboardMain', {
            savedState: { readAreaTag: 'fsx_gen', focusKey: 'fsx_gen', focusIndex: 7 },
        });
        assert.equal(focusedKey(back.inst), 'fsx_gen');
    });

    it('x in the message list (fullExit): leaves the index', async () => {
        const main = await enter('lampboardMain', { lastMenuResult: { fullExit: true } });
        assert.deepEqual(main.inst.artDrawn, []);
        assert.deepEqual(main.client.menuStack.calls, [['prev']]);

        const login = await enter('lampboardLogin', {
            lastMenuResult: { fullExit: true },
        });
        assert.deepEqual(login.client.menuStack.calls, [['next']]);
    });

    it('q: back in the main entry, on to next in the login entry', async () => {
        const main = await enter('lampboardMain');
        main.client.press('q');
        assert.deepEqual(main.client.menuStack.calls, [['prev']]);

        const login = await enter('lampboardLogin');
        login.client.press('escape');
        assert.deepEqual(login.client.menuStack.calls, [['next']]);
    });

    it('login entry with nothing new: straight on to next, nothing drawn', async () => {
        db.stats = noneNew();
        const { inst, client } = await enter('lampboardLogin');
        assert.deepEqual(inst.artDrawn, []);
        assert.deepEqual(client.menuStack.calls, [['next']]);
        assert.equal(client.writes.length, 0);
    });

    it('login entry with new mail: draws; only the first entry skips', async () => {
        const { inst } = await enter('lampboardLogin');
        assert.deepEqual(inst.artDrawn, ['LAMPBRD']);

        db.stats = noneNew();
        const back = await enter('lampboardLogin', {
            savedState: { readAreaTag: 'fsx_gen' },
        });
        assert.deepEqual(back.inst.artDrawn, ['LAMPBRD']);
        assert.deepEqual(back.client.menuStack.calls, []);
    });

    it('a non-ANSI caller: main entry says why and goes back; login entry moves on', async () => {
        const main = await enter('lampboardMain', {
            clientOpts: { emulation: 'petscii' },
        });
        assert.deepEqual(main.inst.artDrawn, []);
        assert.ok(main.client.writes.join('').includes('needs an ANSI terminal'));
        assert.deepEqual(main.client.menuStack.calls, [['prev']]);

        const login = await enter('lampboardLogin', {
            clientOpts: { emulation: 'atascii' },
        });
        assert.deepEqual(login.inst.artDrawn, []);
        assert.equal(login.client.writes.length, 0);
        assert.deepEqual(login.client.menuStack.calls, [['next']]);
    });

    it('a terminal without an emulation object counts as ANSI', async () => {
        const { inst } = await enter('lampboardMain', {
            clientOpts: { emulation: null },
        });
        assert.deepEqual(inst.artDrawn, ['LAMPBRD']);
    });

    it('s cycles columns then back to board order; o flips the order', async () => {
        const { inst, client } = await enter('lampboardMain');
        const seen = [];
        for (let i = 0; i < 6; ++i) {
            client.press('s');
            const sort = tv(inst).getSort();
            seen.push(sort ? sort.column : null);
        }
        assert.deepEqual(seen, ['area', 'new', 'yours', 'total', 'last', null]);
        assert.equal(text(inst, 2), 'Sorted by board order');

        client.press('s'); //  area asc
        client.press('o');
        assert.deepEqual(tv(inst).getSort().order, 'desc');
        assert.equal(text(inst, 2), 'Sorted by Area descending');
        assert.equal(text(inst, 11), 'Sorted by Area descending');
    });

    it('?: shows the help art; any key brings the index back, still working', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('n'); //  fsx_gen
        client.press('?');
        await settle();
        assert.deepEqual(inst.artDrawn, ['LAMPBRD', 'LAMPBRDHLP']);
        //  the key that dismisses help does not reach the form
        client.press('n');
        await settle();
        assert.deepEqual(inst.artDrawn, ['LAMPBRD', 'LAMPBRDHLP', 'LAMPBRD']);
        assert.equal(focusedKey(inst), 'fsx_gen');
        client.press('n');
        assert.equal(focusedKey(inst), 'fsx_mystic');
        assert.equal(text(inst, 3), 'Mystic BBS');
    });

    it('r: re-scan redraws only what changed', async () => {
        const { inst, client } = await enter('lampboardMain');
        db.stats.fsx_bbs.newCount = 4;
        client.press('r');
        await settle();
        assert.equal(text(inst, 2), 'Re-scanned: 1 area(s) changed');
        const row = tv(inst)
            .getItems()
            .find(r => r.key === 'fsx_bbs');
        assert.equal(row.newCount, 4);
        assert.equal(row.state, 'new');
    });

    it('art with no %TV1: main entry falls back; login entry moves on', async () => {
        const main = create('lampboardMain', { mci: { withTable: false } });
        let failed;
        main.inst.initSequenceFailed = err => {
            failed = err;
        };
        main.inst.enter();
        await settle();
        assert.match(failed.message, /art "LAMPBRD" has no %TV1/);

        const login = await enter('lampboardLogin', { mci: { withTable: false } });
        assert.deepEqual(login.client.menuStack.calls, [['next']]);
    });

    it('theme config can rename the art', async () => {
        const { inst } = await enter('lampboardMain', {
            config: { art: { main: 'MYIDX' } },
        });
        assert.deepEqual(inst.artDrawn, ['MYIDX']);
    });

    it('omitMessageAreaTags drops areas in both scopes', async () => {
        const { inst, client } = await enter('lampboardMain', {
            config: { omitMessageAreaTags: ['activitypub_shared'] },
        });
        const has = () =>
            tv(inst)
                .getItems()
                .some(r => r.key === 'activitypub_shared');
        assert.equal(has(), false);
        client.press('v');
        assert.equal(has(), false);
    });
    //  ── review fixes ────────────────────────────────────────────────────────

    it('config.dateTimeFormat formats {lastPost}; otherwise the theme format', async () => {
        const own = await enter('lampboardMain', {
            config: { dateTimeFormat: '[on] DD/MM/YYYY' },
        });
        own.client.press('n'); //  fsx_gen, last post 2026-11-18T12:00Z
        assert.equal(text(own.inst, 10), 'Last post on 18/11/2026');

        const themed = await enter('lampboardMain');
        themed.client.press('n');
        //  the fake theme's 'YYYY-MM-DD HH:mm'
        assert.match(text(themed.inst, 10), /^Last post 2026-11-1[89] \d\d:\d\d$/);
    });

    it('an empty table leaves the last post line blank', async () => {
        db.stats = noneNew();
        const { inst } = await enter('lampboardMain', { config: { hideNoNew: true } });
        assert.equal(tv(inst).getItems().length, 0);
        assert.equal(text(inst, 10), '');
        assert.equal(text(inst, 3), '');
    });

    it('with a sort in force, mark read re-sorts and the snap follows the screen', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('s'); //  area
        client.press('s'); //  new, desc
        assert.deepEqual(tv(inst).getSort().column, 'new');
        assert.equal(tv(inst).getSort().order, 'desc');
        const fsx = () =>
            tv(inst)
                .getItems()
                .filter(r => 'fsxnet' === r.confTag && 'group' !== r.kind)
                .map(r => r.key);
        assert.deepEqual(fsx(), ['fsx_gen', 'fsx_mystic', 'fsx_bbs']);

        while ('fsx_gen' !== focusedKey(inst)) {
            client.press('n');
        }
        client.press('m');
        client.press('y');
        await settle();
        //  fsx_gen (now 0 new) moved below fsx_mystic, on screen too
        assert.deepEqual(fsx(), ['fsx_mystic', 'fsx_gen', 'fsx_bbs']);
        assertScreenMatchesRows(inst, client);
        //  the next new area after fsx_gen on screen is the ActivityPub one
        //  (in the stale order it would have been fsx_mystic)
        assert.equal(focusedKey(inst), 'activitypub_shared');
    });

    it('with a sort in force, re-scan re-sorts', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('s');
        client.press('s'); //  new, desc
        db.stats.fsx_bbs.newCount = 9;
        client.press('r');
        await settle();
        const fsx = tv(inst)
            .getItems()
            .filter(r => 'fsxnet' === r.confTag && 'group' !== r.kind)
            .map(r => r.key);
        assert.deepEqual(fsx, ['fsx_bbs', 'fsx_gen', 'fsx_mystic']);
        assertScreenMatchesRows(inst, client);
    });

    it('re-scan counts areas that dropped out of view', async () => {
        const { inst, client } = await enter('lampboardMain', {
            config: { hideNoNew: true },
        });
        db.stats.fsx_gen.newCount = 0;
        client.press('r');
        await settle();
        assert.ok(
            !tv(inst)
                .getItems()
                .some(r => 'fsx_gen' === r.key)
        );
        assert.equal(text(inst, 2), 'Re-scanned: 1 area(s) changed');
    });

    it('mark read whose stats re-read fails: an error status, logged', async () => {
        const { inst, client } = await enter('lampboardMain', {
            config: { confirmMarkRead: false },
        });
        db.failStatsAfter = 1; //  the entry query works, the next one fails
        client.press('m');
        await settle();
        assert.deepEqual(db.markCalls, ['private_mail']);
        assert.equal(text(inst, 2), 'Error: stats unavailable');
        assert.ok(
            client.logSink.some(
                e => 'warn' === e.level && /cannot re-read the area stats/.test(e.args[1])
            )
        );
    });

    it('an ActivityPub pointer that cannot move is logged; the browser still opens', async () => {
        const { client } = await enter('lampboardMain');
        db.markError = new Error('db locked');
        client.press('n');
        client.press('n');
        client.press('n'); //  activitypub_shared
        client.press('\r', 'return');
        await settle();
        const gotos = client.menuStack.calls.filter(c => 'goto' === c[0]);
        assert.equal(gotos[0][1], 'newScanActivityPubList');
        assert.ok(
            client.logSink.some(
                e => 'warn' === e.level && /ActivityPub area pointer/.test(e.args[1])
            )
        );
    });

    it('left while help is up: the next key does not redraw or re-attach anything', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('?');
        await settle();
        assert.deepEqual(inst.artDrawn, ['LAMPBRD', 'LAMPBRDHLP']);
        //  e.g. an interrupt: realtime reload, or the caller dropping
        inst.leave();
        assert.equal(client.listenerCount('key press'), 0);
        client.press('x');
        await settle();
        assert.deepEqual(inst.artDrawn, ['LAMPBRD', 'LAMPBRDHLP']);
        assert.equal(client.listenerCount('key press'), 0);
    });

    it('left while the mark-read question is up: nothing is marked', async () => {
        const { inst, client } = await enter('lampboardMain');
        client.press('m');
        inst.leave();
        assert.equal(client.listenerCount('key press'), 0);
        client.press('y');
        await settle();
        assert.deepEqual(db.markCalls, []);
    });

    it('left before the stats come back: the login entry neither draws nor moves on', async () => {
        const made = create('lampboardLogin');
        const realStats = messageArea.getMessageAreaStats;
        let release;
        messageArea.getMessageAreaStats = (user, tags, cb) => {
            release = () => realStats(user, tags, cb);
        };
        try {
            made.inst.enter();
            made.inst.leave();
            release();
        } finally {
            messageArea.getMessageAreaStats = realStats;
        }
        await settle();
        assert.deepEqual(made.inst.artDrawn, []);
        assert.deepEqual(made.client.menuStack.calls, []);
    });
});
