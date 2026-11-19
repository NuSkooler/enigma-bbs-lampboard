'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    ConfigDefaults,
    TableDefaults,
    InfoFormatDefaults,
    mergeDefaults,
    tableDefaults,
    infoFormatDefaults,
    deepMerge,
} = require('../../lib/defaults.js');

describe('defaults: mergeDefaults()', () => {
    it('defaults every key when the menu sets nothing', () => {
        const merged = mergeDefaults(undefined);
        Object.keys(ConfigDefaults).forEach(k => {
            assert.ok(k in merged, `missing ${k}`);
        });
        assert.deepEqual(merged.art, { main: 'LAMPBRD', help: 'LAMPBRDHLP' });
        assert.equal(merged.messageListMenu, 'newScanMessageList');
        assert.equal(merged.activityPubListMenu, 'newScanActivityPubList');
        assert.equal(merged.initialScope, 'newscan');
        assert.equal(merged.snapToNew, true);
        assert.equal(merged.confirmMarkRead, true);
        assert.equal(merged.hideNoNew, false);
        assert.equal(merged.newIndicator, 'NEW');
        assert.deepEqual(merged.omitMessageAreaTags, []);
    });

    it('menu values win; art merges per key', () => {
        const merged = mergeDefaults({
            art: { main: 'MYINDEX' },
            newIndicator: '|12*',
            hideNoNew: true,
            initialScope: 'all',
            omitMessageAreaTags: ['x'],
        });
        assert.deepEqual(merged.art, { main: 'MYINDEX', help: 'LAMPBRDHLP' });
        assert.equal(merged.newIndicator, '|12*');
        assert.equal(merged.hideNoNew, true);
        assert.equal(merged.initialScope, 'all');
        assert.deepEqual(merged.omitMessageAreaTags, ['x']);
    });

    it('never mutates its input (the shared menu config)', () => {
        const input = {
            art: { main: 'MYINDEX' },
            omitMessageAreaTags: ['x'],
            newIndicator: '*',
        };
        const snapshot = JSON.parse(JSON.stringify(input));
        const merged = mergeDefaults(input);
        assert.deepEqual(input, snapshot);
        assert.notEqual(merged.art, input.art);
        assert.notEqual(merged.omitMessageAreaTags, input.omitMessageAreaTags);
        merged.art.help = 'CHANGED';
        merged.omitMessageAreaTags.push('y');
        assert.deepEqual(input, snapshot);
    });

    it('never shares objects with the defaults', () => {
        const a = mergeDefaults({});
        a.art.main = 'X';
        a.omitMessageAreaTags.push('z');
        const b = mergeDefaults({});
        assert.equal(b.art.main, 'LAMPBRD');
        assert.deepEqual(b.omitMessageAreaTags, []);
    });

    it('bad values fall back', () => {
        const merged = mergeDefaults({
            initialScope: 'everything',
            art: 'NOTANOBJECT',
            omitMessageAreaTags: 'single_tag',
        });
        assert.equal(merged.initialScope, 'newscan');
        assert.deepEqual(merged.art, { main: 'LAMPBRD', help: 'LAMPBRDHLP' });
        assert.deepEqual(merged.omitMessageAreaTags, ['single_tag']);

        assert.deepEqual(mergeDefaults({ art: { main: '' } }).art.main, 'LAMPBRD');
    });

    it('keeps keys it does not know (menuFlags, info formats...)', () => {
        const merged = mergeDefaults({
            menuFlags: ['noHistory'],
            mainInfoFormat10: '{x}',
        });
        assert.deepEqual(merged.menuFlags, ['noHistory']);
        assert.equal(merged.mainInfoFormat10, '{x}');
    });
});

describe('defaults: table and info formats', () => {
    it('tableDefaults() is a fresh deep copy', () => {
        const a = tableDefaults();
        a.columns.new.rules.push({ when: '> 9' });
        a.columnOrder.pop();
        assert.equal(TableDefaults.columns.new.rules.length, 2);
        assert.equal(TableDefaults.columnOrder.length, 6);
        assert.deepEqual(tableDefaults(), JSON.parse(JSON.stringify(TableDefaults)));
    });

    it('table defaults have no sort (board order)', () => {
        assert.equal(TableDefaults.sort, undefined);
    });

    it('info format defaults only for form "main"', () => {
        assert.deepEqual(
            infoFormatDefaults('main'),
            Object.assign({}, InfoFormatDefaults)
        );
        assert.deepEqual(infoFormatDefaults('other'), {});
        const a = infoFormatDefaults('main');
        a[10] = 'changed';
        assert.notEqual(InfoFormatDefaults[10], 'changed');
    });

    it('deepMerge(): arrays replace, undefined skipped, objects merge', () => {
        assert.deepEqual(
            deepMerge(
                { a: [1, 2], b: { c: 1, d: 2 }, e: 1 },
                {
                    a: [3],
                    b: { c: 9 },
                    e: undefined,
                }
            ),
            { a: [3], b: { c: 9, d: 2 }, e: 1 }
        );
    });
});
