'use strict';

//
//  Shared setup for the integration tests (they need a real ENiGMA½ tree in
//  $ENIGMA_ROOT). Not a *.test.js file, so the runner does not pick it up.
//
//  ENiGMA's core modules capture logger.log and config.get when they are
//  first required, so the test config and the logger stub go in BEFORE any
//  core module (or lampboard.js) is required: tests call installCore() from
//  before() and require everything else after it. restoreCore() puts back
//  only what installCore() swapped (the previous values may legitimately be
//  undefined). Each test file runs in its own process (node --test), so a
//  module that captured the test config keeps it only for that file.
//

const { EventEmitter } = require('events');
const fs = require('fs');
const paths = require('path');

const RepoRoot = paths.join(__dirname, '..', '..');
const EnigmaRoot = process.env.ENIGMA_ROOT
    ? paths.resolve(process.env.ENIGMA_ROOT)
    : null;

function skipReason() {
    if (!EnigmaRoot) {
        return 'ENIGMA_ROOT is not set';
    }
    if (!fs.existsSync(paths.join(EnigmaRoot, 'core', 'menu_module.js'))) {
        return `ENIGMA_ROOT (${EnigmaRoot}) is not an ENiGMA½ tree`;
    }
    if (!fs.existsSync(paths.join(EnigmaRoot, 'node_modules'))) {
        return `ENIGMA_ROOT (${EnigmaRoot}) has no node_modules (run npm ci there)`;
    }
    return false;
}

function enigma(relPath) {
    return require(paths.join(EnigmaRoot, relPath));
}

function makeLogStub(sink = []) {
    const stub = {};
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].forEach(level => {
        stub[level] = (...args) => sink.push({ level, args });
    });
    stub.child = () => stub;
    return stub;
}

//  Conferences for the test config, in board order once sorted
function testConferences() {
    return {
        system_internal: {
            name: 'System Internal',
            desc: 'Built in conference for private messages, bulletins, etc.',
            areas: {
                private_mail: { name: 'Private Mail', desc: 'Private user to user mail' },
                local_bulletin: { name: 'System Bulletins', desc: 'Bulletin messages' },
            },
        },
        local: {
            name: 'Local',
            desc: 'Local discussion',
            sort: 1,
            areas: {
                local_general: { name: 'General', desc: 'General chit-chat', sort: 1 },
                local_empty: { name: 'Empty Area', desc: 'Nothing here yet', sort: 2 },
            },
        },
        fsxnet: {
            name: 'fsxNet',
            desc: 'fsxNet echomail',
            sort: 2,
            areas: {
                fsx_gen: { name: 'fsxNet General', desc: 'General chat', sort: 1 },
                fsx_bbs: { name: 'BBS Discussion', desc: 'BBS talk', sort: 2 },
                fsx_mystic: { name: 'Mystic', desc: 'Mystic BBS', sort: 3 },
            },
        },
        activitypub_internal: {
            name: 'ActivityPub',
            desc: 'Fediverse',
            hideFromBrowse: true,
            areas: {
                activitypub_shared: {
                    name: 'Fediverse',
                    desc: 'Public posts',
                    addressFlavor: 'activitypub',
                },
            },
        },
    };
}

function testConfig() {
    return {
        debug: { assertsEnabled: false },
        menus: { cls: false },
        general: { boardName: 'lampboard test' },
        paths: { mods: paths.join(EnigmaRoot, 'mods') },
        messageConferences: testConferences(),
    };
}

const swapped = {};

function installCore({ config = testConfig(), logSink = [] } = {}) {
    const configModule = enigma('core/config.js');
    const loggerModule = enigma('core/logger.js');

    if (!swapped.config) {
        swapped.config = true;
        swapped.prevGet = configModule.get;
        configModule.get = () => config;
    }
    if (!swapped.log) {
        swapped.log = true;
        swapped.prevLog = loggerModule.log;
        loggerModule.log = makeLogStub(logSink);
    }
    return { config, logSink };
}

function restoreCore() {
    let configModule;
    let loggerModule;
    try {
        configModule = enigma('core/config.js');
        loggerModule = enigma('core/logger.js');
    } catch (e) {
        return;
    }
    if (swapped.config) {
        configModule.get = swapped.prevGet;
        swapped.config = false;
        delete swapped.prevGet;
    }
    if (swapped.log) {
        loggerModule.log = swapped.prevLog;
        swapped.log = false;
        delete swapped.prevLog;
    }
}

//  What a terminal shows: SGR dropped, ESC[nC as n spaces (bare = 1)
function visible(s) {
    return String(s)
        .replace(/\x1b\[(\d*)C/g, (m, n) => ' '.repeat('' === n ? 1 : parseInt(n, 10)))
        .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

//  The text drawn after the last cursor move to |row|
function drawnOnRow(writes, row) {
    const all = writes.join('');
    const re = new RegExp(`\\x1b\\[${row};\\d+H`, 'g');
    let last = -1;
    while (null !== re.exec(all)) {
        last = re.lastIndex;
    }
    if (last < 0) {
        return null;
    }
    const rest = all.slice(last);
    const next = rest.search(/\x1b\[\d+;\d+H/);
    return visible(-1 === next ? rest : rest.slice(0, next));
}

class FakeMenuStack {
    constructor() {
        this.calls = [];
        this.gotoError = null;
    }
    next(cb) {
        this.calls.push(['next']);
        if (cb) {
            cb(null);
        }
    }
    prev(cb) {
        this.calls.push(['prev']);
        if (cb) {
            cb(null);
        }
    }
    goto(name, options, cb) {
        this.calls.push(['goto', name, options]);
        if (cb) {
            cb(this.gotoError);
        }
    }
    initSucceeded() {}
    initFailureWouldCycle() {
        return false;
    }
}

class FakeClient extends EventEmitter {
    constructor({
        termWidth = 80,
        termHeight = 25,
        emulation = 'ansi',
        props = {},
    } = {}) {
        super();
        this.writes = [];
        const push = s => this.writes.push(String(s));
        this.term = {
            termWidth,
            termHeight,
            outputEncoding: 'cp437',
            write: push,
            rawWrite: push,
            beginWrite() {},
            commitWrite() {},
            encode: s => Buffer.from(String(s), 'latin1'),
            emulation: emulation ? { name: emulation, layers: new Map() } : undefined,
        };
        this.logSink = [];
        this.log = makeLogStub(this.logSink);
        this.user = {
            userId: 42,
            username: 'tester',
            properties: Object.assign({}, props),
            getProperty(name) {
                return this.properties[name];
            },
        };
        this.acs = {
            hasMessageConfRead: () => true,
            hasMessageAreaRead: () => true,
            hasMenuModuleAccess: () => true,
        };
        this.currentTheme = {
            helpers: {
                getDateTimeFormat: () => 'YYYY-MM-DD HH:mm',
                getDateFormat: () => 'YYYY-MM-DD',
                getTimeFormat: () => 'HH:mm',
            },
            menus: {},
            prompts: {},
        };
        this.menuStack = new FakeMenuStack();
        this.interruptQueue = { hasItems: () => false };
    }

    waitForKeyPress(cb) {
        this.once('key press', cb);
    }

    //  a key the way ENiGMA's input decoder hands one over
    press(ch, name) {
        this.emit('key press', ch, { name: name || ch });
    }
}

//  The menu entries as shipped, parsed fresh (each test gets its own copy)
function loadMenus() {
    const hjson = require(require.resolve('hjson', { paths: [RepoRoot, EnigmaRoot] }));
    return hjson.parse(
        fs.readFileSync(paths.join(RepoRoot, 'menus', 'lampboard.hjson'), 'utf8')
    ).menus;
}

module.exports = {
    RepoRoot,
    EnigmaRoot,
    skipReason,
    enigma,
    makeLogStub,
    testConfig,
    testConferences,
    installCore,
    restoreCore,
    visible,
    drawnOnRow,
    FakeClient,
    FakeMenuStack,
    loadMenus,
};
