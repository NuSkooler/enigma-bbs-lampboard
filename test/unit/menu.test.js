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
            //  the login chain runs the files-only new scan, which goes on to
            //  the stock chain
            assert.equal(menus.lampboardLogin.next, 'fullLoginSequenceFileScan');
            assert.equal(menus.fullLoginSequenceFileScan.module, 'new_scan');
            assert.equal(menus.fullLoginSequenceFileScan.config.skipMessageBase, true);
            assert.equal(
                menus.fullLoginSequenceFileScan.next,
                'fullLoginSequenceSysStats'
            );
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

//  plain text: SGR and pipe codes dropped
const plain = s => s.replace(/\x1b\[[0-9;]*m/g, '').replace(/\|[0-9]{2}/g, '');

describe('placeholder art', () => {
    it('help: every key is separated from its description', () => {
        const help = fs.readFileSync(
            paths.join(RepoRoot, 'art', 'LAMPBRDHLP.ANS'),
            'latin1'
        );
        //  key lines: two-space indent, key, two or more spaces, description
        const lines = help.split('\r\n').map(plain);
        const keyLines = lines.slice(2, 14);
        keyLines.forEach(l =>
            assert.match(l, /^ {2}\S(.*?\S)? {2,}\S/, `bad key line: ${l}`)
        );
        assert.ok(lines.some(l => l.includes('Up/Down PgUp/PgDn  Move')));
    });

    it('help: no line is wider than 79 columns', () => {
        const help = fs.readFileSync(
            paths.join(RepoRoot, 'art', 'LAMPBRDHLP.ANS'),
            'latin1'
        );
        help.split('\r\n')
            .map(plain)
            .forEach(l => assert.ok(l.length <= 79, `too wide: ${l}`));
    });
});

describe(
    'default info formats fit the shipped TL widths',
    { skip: !hjson && 'hjson not installed' },
    () => {
        const {
            ConfigDefaults,
            InfoFormatDefaults,
            TableDefaults,
        } = require('../../lib/defaults.js');
        const longest = (...texts) =>
            texts.reduce((a, b) => (b.length > a.length ? b : a), '');
        const labels = Object.values(TableDefaults.columns).map(c => c.label || '');

        //  the longest each field can be with the default texts
        const worst = {
            scopeText: longest(
                ConfigDefaults.scopeNewScanText,
                ConfigDefaults.scopeAllText
            ),
            filterText: longest(
                ConfigDefaults.filterOnText,
                ConfigDefaults.filterOffText
            ),
            sortText: ConfigDefaults.sortFormat
                .replace(
                    '{sortLabel}',
                    longest(ConfigDefaults.moduleOrderText, ...labels)
                )
                .replace(
                    '{sortOrderText}',
                    longest(ConfigDefaults.sortAscText, ConfigDefaults.sortDescText)
                ),
            //  'MM/DD/YYYY h:mm a', a long theme date/time format
            lastPostLine: ConfigDefaults.lastPostLineFormat.replace(
                '{lastPost}',
                '11/19/2026 10:45 pm'
            ),
        };

        it('each default, at its longest, fits its view in menus/lampboard.hjson', () => {
            const { menus } = hjson.parse(source);
            const mci = menus.lampboardMain.form[0].mci;
            Object.keys(InfoFormatDefaults).forEach(id => {
                const text = plain(
                    InfoFormatDefaults[id].replace(/\{(\w+)\}/g, (m, f) => worst[f])
                );
                const width = mci[`TL${id}`].width;
                assert.ok(
                    text.length <= width,
                    `mainInfoFormat${id} needs ${text.length} > TL${id} width ${width}: ${text}`
                );
            });
        });
    }
);

describe('README', () => {
    const readme = fs.readFileSync(paths.join(RepoRoot, 'README.md'), 'utf8');
    const blocks = [...readme.matchAll(/```hjson\n([\s\S]*?)```/g)].map(m => m[1]);

    it('every hjson snippet parses', { skip: !hjson && 'hjson not installed' }, () => {
        assert.ok(blocks.length > 0);
        blocks.forEach(b => {
            const src = b.trim();
            const parses = [src, `{${src}}`].some(s => {
                try {
                    hjson.parse(s);
                    return true;
                } catch (e) {
                    return false;
                }
            });
            assert.ok(parses, `does not parse:\n${src}`);
        });
    });

    it(
        'the table layout block matches the code defaults',
        {
            skip: !hjson && 'hjson not installed',
        },
        () => {
            const { TableDefaults } = require('../../lib/defaults.js');
            const block = blocks.find(b => b.startsWith('header: true'));
            assert.ok(block, 'no table layout block');
            assert.deepEqual(
                JSON.parse(JSON.stringify(hjson.parse(`{${block}}`))),
                JSON.parse(JSON.stringify(TableDefaults))
            );
        }
    );

    it('documents every config key', () => {
        const { ConfigDefaults } = require('../../lib/defaults.js');
        Object.keys(ConfigDefaults).forEach(k => {
            const key = 'art' === k ? 'art.main' : k;
            assert.ok(readme.includes(`\`${key}\``), `README lacks ${key}`);
        });
    });
});
