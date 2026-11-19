'use strict';

//  Static checks on menus/lampboard.hjson and the repo layout

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const paths = require('path');

const RepoRoot = paths.join(__dirname, '..', '..');
const MenuFile = paths.join(RepoRoot, 'menus', 'lampboard.hjson');

//  hjson: a devDependency here, else ENiGMA's (ENIGMA_ROOT); skip if neither
function loadHjson() {
    const from = [RepoRoot];
    if (process.env.ENIGMA_ROOT) {
        from.push(process.env.ENIGMA_ROOT);
    }
    for (const dir of from) {
        try {
            return require(require.resolve('hjson', { paths: [dir] }));
        } catch (e) {
            //  next
        }
    }
    return null;
}

const hjson = loadHjson();
const source = fs.readFileSync(MenuFile, 'utf8');

describe('menus/lampboard.hjson', () => {
    it('parses', { skip: !hjson && 'hjson not installed' }, () => {
        const parsed = hjson.parse(source);
        assert.ok(parsed.menus.lampboardMain);
        assert.ok(parsed.menus.lampboardLogin);
    });

    it(
        'both entries use the module; only the login entry has next',
        {
            skip: !hjson && 'hjson not installed',
        },
        () => {
            const { menus } = hjson.parse(source);
            assert.equal(menus.lampboardMain.module, '@userModule:lampboard');
            assert.equal(menus.lampboardLogin.module, '@userModule:lampboard');
            assert.equal(menus.lampboardMain.next, undefined);
            assert.equal(typeof menus.lampboardLogin.next, 'string');
            //  the module draws its own art
            assert.equal(menus.lampboardMain.art, undefined);
            assert.equal(menus.lampboardLogin.art, undefined);
            //  no menu ACS: a failed one strands the caller (design section 6)
            assert.equal(menus.lampboardMain.config.acs, undefined);
            assert.equal(menus.lampboardLogin.config.acs, undefined);
        }
    );

    it(
        'binds every method lampboard has, the same way in both entries',
        {
            skip: !hjson && 'hjson not installed',
        },
        () => {
            const { menus } = hjson.parse(source);
            const methods = entry =>
                entry.form[0].actionKeys
                    .map(k => k.action)
                    .concat(entry.form[0].submit['*'].map(s => s.action));
            const expected = [
                '@method:nextNew',
                '@method:toggleScope',
                '@method:toggleFilter',
                '@method:markRead',
                '@method:rescan',
                '@method:cycleSort',
                '@method:toggleSortOrder',
                '@method:help',
                '@method:quit',
                '@method:readArea',
            ];
            assert.deepEqual(
                methods(menus.lampboardMain).sort(),
                expected.slice().sort()
            );
            assert.deepEqual(menus.lampboardMain.form, menus.lampboardLogin.form);
            assert.equal(menus.lampboardMain.form[0].mci.TV1.submit, true);
            assert.equal(menus.lampboardMain.form[0].mci.TV1.argName, 'areaTag');
        }
    );

    it(
        'never binds Home, End or other list keys, nor "enter"',
        {
            skip: !hjson && 'hjson not installed',
        },
        () => {
            const { menus } = hjson.parse(source);
            const bound = [];
            Object.values(menus).forEach(m =>
                ((m.form && m.form[0] && m.form[0].actionKeys) || []).forEach(k =>
                    bound.push(...k.keys)
                )
            );
            [
                'home',
                'end',
                'page up',
                'page down',
                'up',
                'down',
                'enter',
                'return',
            ].forEach(k => {
                assert.ok(!bound.includes(k), `binds ${k}`);
            });
        }
    );

    it('source has no raw "enter" key name', () => {
        assert.doesNotMatch(source, /"enter"/);
    });
});

describe('repo layout', () => {
    it('lampboard.js is the only top-level .js (ENiGMA requires them all at boot)', () => {
        const js = fs.readdirSync(RepoRoot).filter(f => f.endsWith('.js'));
        assert.deepEqual(js, ['lampboard.js']);
    });

    it('ships the placeholder art', () => {
        ['LAMPBRD.ANS', 'LAMPBRDHLP.ANS'].forEach(f => {
            assert.ok(fs.existsSync(paths.join(RepoRoot, 'art', f)), f);
        });
        const main = fs.readFileSync(
            paths.join(RepoRoot, 'art', 'LAMPBRD.ANS'),
            'latin1'
        );
        ['%TV1', '%TL2', '%TL3', '%TL10', '%TL11', '%TL12'].forEach(mci => {
            assert.ok(main.includes(mci), `LAMPBRD.ANS lacks ${mci}`);
        });
    });
});
