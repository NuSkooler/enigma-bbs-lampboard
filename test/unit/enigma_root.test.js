'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const paths = require('path');

const enigmaRoot = require('../../lib/enigma_root.js');

function makeFakeRoot() {
    const dir = fs.mkdtempSync(paths.join(os.tmpdir(), 'lampboard-root-'));
    fs.mkdirSync(paths.join(dir, 'core'));
    fs.writeFileSync(
        paths.join(dir, 'core', 'menu_module.js'),
        "exports.MenuModule = class {};\nexports.fake = 'yes';\n"
    );
    fs.mkdirSync(paths.join(dir, 'mods', 'lampboard'), { recursive: true });
    return dir;
}

describe('enigma_root', () => {
    let saved;
    let dir;

    beforeEach(() => {
        saved = process.env.ENIGMA_ROOT;
        enigmaRoot._reset();
        dir = makeFakeRoot();
    });

    afterEach(() => {
        if (undefined === saved) {
            delete process.env.ENIGMA_ROOT;
        } else {
            process.env.ENIGMA_ROOT = saved;
        }
        enigmaRoot._reset();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('ENIGMA_ROOT comes first', () => {
        process.env.ENIGMA_ROOT = dir;
        assert.equal(enigmaRoot.candidates('/nowhere/mods/lampboard')[0], dir);
        assert.equal(enigmaRoot.findRoot('/nowhere/mods/lampboard'), dir);
        assert.equal(enigmaRoot.requireCore('/nowhere', 'menu_module.js').fake, 'yes');
    });

    it('finds the root two levels up from the mod folder', () => {
        delete process.env.ENIGMA_ROOT;
        const modDir = paths.join(dir, 'mods', 'lampboard');
        assert.equal(enigmaRoot.findRoot(modDir), dir);
    });

    it('a bad ENIGMA_ROOT falls through to the next candidate', () => {
        process.env.ENIGMA_ROOT = paths.join(dir, 'does-not-exist');
        const modDir = paths.join(dir, 'mods', 'lampboard');
        assert.equal(enigmaRoot.findRoot(modDir), dir);
    });

    it('caches the root', () => {
        process.env.ENIGMA_ROOT = dir;
        enigmaRoot.findRoot('/x');
        process.env.ENIGMA_ROOT = '/elsewhere';
        assert.equal(enigmaRoot.findRoot('/x'), dir);
    });

    it('isEnigmaRoot()', () => {
        assert.equal(enigmaRoot.isEnigmaRoot(dir), true);
        assert.equal(enigmaRoot.isEnigmaRoot(os.tmpdir()), false);
        assert.equal(enigmaRoot.isEnigmaRoot(null), false);
    });
});
