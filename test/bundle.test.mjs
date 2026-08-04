// Static checks on the rollup IIFE bundle.
//
// This artifact ships to npm inside /lib and is consumed by brave-core, but CI
// only ever asserted `test -s` on it. These are the properties that cannot be
// observed by running the bundle, so behavior.test.mjs cannot cover them.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { LIB_DIR } from './harness.mjs';

const bundlePath = resolve(LIB_DIR, 'index.iife.min.js');
const bundle = readFileSync(bundlePath, 'utf8');

test('bundle exposes the walletStandardBrave global', () => {
    assert.match(bundle, /^var walletStandardBrave\s*=/, 'IIFE wrapper or global name changed');
    assert.ok(bundle.includes('"use strict"'), 'bundle is not in strict mode');
});

test('bundle contains no commonjsRequire shim', () => {
    // @rollup/plugin-commonjs emits a `commonjsRequire` helper when it cannot
    // statically resolve a require(). That helper *throws at runtime*, so a
    // bundle containing it is a latent crash that a non-empty file check and
    // even a happy-path smoke test can both miss.
    assert.ok(
        !bundle.includes('commonjsRequire'),
        'bundle contains a commonjsRequire shim, which throws at runtime on an unresolved require'
    );
});

test('bundle stays unmangled and reviewable', () => {
    // rollup.config.js runs terser with `mangle: false, compress: false` on
    // purpose, so the bundle shipped into brave-core stays auditable. If a
    // plugin-terser bump ever flipped those defaults, the only visible symptom
    // would be a smaller file -- nothing else in CI would notice.
    const identifiers = [
        'walletStandardBrave',
        'registerWallet',
        'BraveWalletWalletAccount',
        'signAndSendTransaction',
        'RegisterWalletEvent',
    ];
    const missing = identifiers.filter((identifier) => !bundle.includes(identifier));
    assert.deepEqual(
        missing,
        [],
        `bundle looks mangled (missing: ${missing.join(
            ', '
        )}); check terser's mangle/compress options in rollup.config.js`
    );
});

test('sourcemap is present and well formed', () => {
    const map = JSON.parse(readFileSync(`${bundlePath}.map`, 'utf8'));
    assert.ok(Array.isArray(map.sources) && map.sources.length > 0, 'sourcemap has no sources');
    assert.ok(typeof map.mappings === 'string' && map.mappings.length > 0, 'sourcemap has no mappings');
    assert.ok(
        map.sources.some((source) => source.includes('src/')),
        'sourcemap does not reference any original sources'
    );
});

test('bundle size is reported', () => {
    // Report-only by design. Terser already runs with mangle and compress off,
    // so this project has explicitly traded size for auditability -- gating on
    // bytes would enforce a goal it does not have and would block routine
    // dependency bumps. Logging keeps growth visible to a reviewer instead.
    const raw = Buffer.byteLength(bundle);
    const gzip = gzipSync(bundle, { level: 9 }).length;
    console.log(`    bundle size: ${raw.toLocaleString()} bytes raw, ${gzip.toLocaleString()} bytes gzip`);
    assert.ok(raw > 0);
});
