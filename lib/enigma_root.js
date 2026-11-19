'use strict';

//
//  Finds the ENiGMA½ install lampboard is running in, so the mod works
//  whether it is copied into mods/ or symlinked there (a symlinked folder's
//  __dirname is its real path, so a plain '../../core/...' would miss).
//
//  Candidates, first match wins:
//    1. $ENIGMA_ROOT (tests and CI)
//    2. two levels up from the folder holding lampboard.js
//       (<root>/mods/lampboard -> <root>)
//    3. the folder of the main script (main.js)
//    4. the current directory
//
const fs = require('fs');
const paths = require('path');

let root;

function isEnigmaRoot(dir) {
    return !!dir && fs.existsSync(paths.join(dir, 'core', 'menu_module.js'));
}

function candidates(modDir) {
    return [
        process.env.ENIGMA_ROOT ? paths.resolve(process.env.ENIGMA_ROOT) : null,
        paths.resolve(modDir, '..', '..'),
        require.main && require.main.filename
            ? paths.dirname(require.main.filename)
            : null,
        process.cwd(),
    ].filter(Boolean);
}

//  |modDir| is the folder holding lampboard.js
function findRoot(modDir) {
    if (root) {
        return root;
    }
    const tried = candidates(modDir);
    const found = tried.find(isEnigmaRoot);
    if (!found) {
        throw new Error(
            `lampboard: cannot find ENiGMA's core/ (looked in ${tried.join(', ')})`
        );
    }
    root = found;
    return root;
}

//  require('<enigma root>/<relPath>'), e.g. 'core/message_area.js'
function requireFromRoot(modDir, relPath) {
    return require(paths.join(findRoot(modDir), relPath));
}

//  require('<enigma root>/core/<name>')
function requireCore(modDir, name) {
    return requireFromRoot(modDir, paths.join('core', name));
}

//  A package from ENiGMA's node_modules: a mod folder (copied or symlinked)
//  has no node_modules of its own
function requireDep(modDir, name) {
    return require(require.resolve(name, { paths: [findRoot(modDir)] }));
}

//  tests only: forget the cached root
function _reset() {
    root = undefined;
}

module.exports = {
    isEnigmaRoot,
    candidates,
    findRoot,
    requireFromRoot,
    requireCore,
    requireDep,
    _reset,
};
