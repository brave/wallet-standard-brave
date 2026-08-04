// Checks what actually reaches npm, and that package.json's declared metadata
// still matches reality.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { LIB_DIR, LIB_DIR_OVERRIDE, ROOT } from './harness.mjs';

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

// `npm pack` is rooted at this package, so it can only ever describe this repo's
// own ./lib. Skip rather than silently attest to a directory we were not pointed at.
const packSkip = LIB_DIR_OVERRIDE && `npm pack cannot target WALLET_STANDARD_LIB_DIR=${LIB_DIR_OVERRIDE}`;

/** File list npm would publish, without writing a tarball anywhere. Spawning npm is slow, so memoize. */
let packed;
function packedFiles() {
    if (!packed) {
        const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        packed = JSON.parse(output)[0].files.map((file) => file.path);
    }
    return packed;
}

test('every declared entry point is actually published', { skip: packSkip }, () => {
    const declared = new Set(
        [pkg.main, pkg.module, pkg.types, ...Object.values(pkg.exports)].map((path) => path.replace(/^\.\//, ''))
    );
    // Shipped for brave-core and referenced by nothing in package.json, so it
    // would silently vanish from the tarball if `files` were ever narrowed.
    declared.add('lib/index.iife.min.js');
    // Without this, `require()` of lib/cjs breaks under "type": "module".
    declared.add('lib/cjs/package.json');

    const missing = [...declared].filter((path) => !packedFiles().includes(path));
    assert.deepEqual(missing, [], `declared entry points missing from the npm tarball: ${missing.join(', ')}`);
});

test('the tarball does not leak development files', { skip: packSkip }, () => {
    const leaked = packedFiles().filter((path) => path.startsWith('test/') || path.startsWith('.github/'));
    assert.deepEqual(leaked, [], `unexpected files in the npm tarball: ${leaked.join(', ')}`);
});

test('lib/cjs/package.json pins the commonjs type', () => {
    // Written by `shx echo '{ "type": "commonjs" }' > ...` in the package script.
    // That redirect is the most fragile line in the build and is what makes
    // require() of the CJS output work at all under the root "type": "module".
    const cjsPkg = JSON.parse(readFileSync(resolve(LIB_DIR, 'cjs/package.json'), 'utf8'));
    assert.deepEqual(cjsPkg, { type: 'commonjs' });
});

test('type declarations are emitted for consumers', () => {
    const types = readFileSync(resolve(LIB_DIR, 'types/index.d.ts'), 'utf8');
    assert.match(types, /initialize/, 'published types do not declare initialize');
});

test('engines.node is not below what the runtime dependencies require', () => {
    // package.json claimed ">=16" while @solana/web3.js -> @solana/codecs-numbers
    // had already moved the real floor to >=20.18.0. Nothing caught the drift
    // because CI only ever ran a single Node version.
    const lock = JSON.parse(readFileSync(resolve(ROOT, 'package-lock.json'), 'utf8'));
    const declared = floorOf(pkg.engines.node);
    assert.ok(declared, `could not parse a floor out of engines.node "${pkg.engines.node}"`);

    const violations = [];
    for (const [path, meta] of Object.entries(lock.packages)) {
        if (!path || meta.dev || meta.optional) continue;
        const required = floorOf(meta.engines?.node);
        if (required && compare(required, declared) > 0) {
            violations.push(`${path.replace(/^node_modules\//, '')} requires ${meta.engines.node}`);
        }
    }

    assert.deepEqual(
        violations,
        [],
        `runtime dependencies require a newer Node than engines.node (${pkg.engines.node}):\n  ${violations.join(
            '\n  '
        )}`
    );
});

/**
 * Lowest Node version a semver range admits, as [major, minor, patch], or null
 * for no constraint.
 *
 * Only the floor matters here, so upper bounds are irrelevant -- but the operator
 * is not: `^20.19.0 || >=22.12.0` admits Node 20, and reading only the `>=` clause
 * would wrongly report it as requiring 22. Ranges this cannot parse fail loudly,
 * because a range silently treated as "no constraint" defeats the whole check.
 */
function floorOf(range) {
    if (!range) return null;

    // ||-separated alternatives each satisfy the range on their own, so the
    // effective floor is the lowest among them.
    const floors = [];
    for (const alternative of range.split('||')) {
        const text = alternative.trim();
        if (text === '' || text === '*') return null;

        const match = text.match(/^(>=|>|\^|~)?\s*(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/);
        assert.ok(match, `unhandled engines.node syntax "${text}" in "${range}" -- teach floorOf about it`);

        const [, , major, minor, patch] = match;
        floors.push([Number(major), number(minor), number(patch)]);
    }

    return floors.sort(compare)[0];
}

/** A wildcard or absent version component contributes nothing to the floor. */
function number(component) {
    const value = Number(component);
    return Number.isInteger(value) ? value : 0;
}

function compare(a, b) {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
