// Exercises the *built* artifacts, not the TypeScript sources.
//
// CI previously proved only that lib/index.iife.min.js was non-empty and that
// lib/{cjs,esm} exported something named `initialize`. Nothing ever called it, so
// a bundler or compiler regression could ship broken output with CI green.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { exerciseWallet, LIB_DIR, makeWindowStub, SOLANA_CHAINS } from './harness.mjs';

const IIFE_GLOBAL = 'walletStandardBrave';

/**
 * Evaluates the IIFE bundle with `window` bound to our stub and returns the
 * global it defines. `var walletStandardBrave` is function-scoped inside a
 * Function body, so nothing leaks -- and running in the host realm (like the
 * ESM and CJS targets already do) keeps `instanceof Error` and
 * `instanceof Uint8Array` meaningful in the assertions.
 */
function loadIifeBundle() {
    const source = readFileSync(resolve(LIB_DIR, 'index.iife.min.js'), 'utf8');
    const win = makeWindowStub();
    const namespace = new Function('window', 'self', `${source}\nreturn ${IIFE_GLOBAL};`)(win, win);
    assert.ok(namespace, `${IIFE_GLOBAL} was not defined by the IIFE bundle`);
    return { namespace, win };
}

/**
 * The ESM and CJS builds read the ambient `window`, so install the stub globally
 * for those two and always tear it down. The IIFE gets its own via closure.
 */
function withGlobalWindow(namespace) {
    const win = makeWindowStub();
    const had = 'window' in globalThis;
    const previous = globalThis.window;
    globalThis.window = win;
    try {
        return exerciseWallet(namespace, win);
    } finally {
        if (had) globalThis.window = previous;
        else delete globalThis.window;
    }
}

const targets = {
    esm: async () => withGlobalWindow(await import(pathToFileURL(resolve(LIB_DIR, 'esm/index.js')).href)),
    cjs: async () => withGlobalWindow(createRequire(import.meta.url)(resolve(LIB_DIR, 'cjs/index.js'))),
    iife: async () => {
        const { namespace, win } = loadIifeBundle();
        return exerciseWallet(namespace, win);
    },
};

// One oracle for all three targets. The IIFE goes through rollup +
// plugin-commonjs + babel + terser while lib/{cjs,esm} come straight from tsc,
// so holding them to a single expectation is what catches a bundler change that
// silently diverges the bundle from the compiler output.
const expected = {
    name: 'Brave Wallet',
    version: '1.0.0',
    chains: SOLANA_CHAINS,
    iconPrefix: 'data:image/svg+xml;base64,',
    walletFrozen: true,
    chainsCopied: true,
    subscribed: ['wallet-standard:app-ready'],
    features: [
        'braveWallet:',
        'solana:signAndSendTransaction',
        'solana:signMessage',
        'solana:signTransaction',
        'standard:connect',
        'standard:disconnect',
        'standard:events',
    ],
    featureVersions: {
        'braveWallet:': null,
        'solana:signAndSendTransaction': '1.0.0',
        'solana:signMessage': '1.0.0',
        'solana:signTransaction': '1.0.0',
        'standard:connect': '1.0.0',
        'standard:disconnect': '1.0.0',
        'standard:events': '1.0.0',
    },
    supportedTransactionVersions: {
        signAndSendTransaction: ['legacy', 0],
        signTransaction: ['legacy', 0],
    },
    braveWalletPassthrough: true,
    errors: {
        beforeConnect: 'not connected',
        invalidAccount: 'invalid account',
        invalidChain: 'invalid chain',
        conflictingChain: 'conflicting chain',
        afterDisconnect: 'not connected',
    },
    accountsBeforeConnect: 0,
    connectAccountCount: 1,
    changeEventsAfterConnect: ['accounts'],
    account: {
        address: 'BraveTestAddress11111111111111111111111111',
        chains: SOLANA_CHAINS,
        features: ['solana:signAndSendTransaction', 'solana:signMessage', 'solana:signTransaction'],
        publicKeyBytes: Array(32).fill(7),
        publicKeyIsUint8Array: true,
        frozen: true,
        publicKeyCopied: true,
    },
    signMessage: { signatureLength: 64, signedMessage: 'brave wallet standard' },
    signTransaction: { byteLength: 134, isUint8Array: true },
    signTransactionBatch: [134, 134],
    signAndSendTransaction: { signatureLength: 64, distinctSignatureBytes: [2] },
    changeEventsAfterSigning: 1,
    afterAccountChanged: {
        address: 'BraveRotatedAddress222222222222222222222222',
        changeEventCount: 2,
    },
    providerDisconnected: true,
    accountsAfterDisconnect: 0,
    changeEventsAfterUnsubscribe: 2,
    providerCalls: [
        'connect',
        'signMessage',
        'signTransaction',
        'signAllTransactions',
        'signAndSendTransaction',
        'disconnect',
    ],
};

for (const [name, load] of Object.entries(targets)) {
    test(`${name} build exposes the full wallet surface`, async () => {
        assert.deepEqual(await load(), expected);
    });
}
