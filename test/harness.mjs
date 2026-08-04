// Shared fixtures and a driver that exercises the wallet's whole public surface.
//
// This is deliberately target-agnostic: it takes a module namespace exposing
// `initialize` and returns a snapshot, so the same code can drive the ESM build,
// the CJS build and the IIFE bundle and prove the three agree.

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBKEY_BYTES = new Uint8Array(32).fill(7);
const ADDRESS = 'BraveTestAddress11111111111111111111111111';
const ROTATED_ADDRESS = 'BraveRotatedAddress222222222222222222222222';
const SIGNATURE_BYTES = new Uint8Array(64).fill(1);
// base58 of a 64-byte all-0x02 signature. signAndSendTransaction pushes this
// through bs58.decode, the only bs58 path the build actually depends on, so the
// decoded result is asserted byte-for-byte downstream.
const SEND_SIGNATURE_BS58 = '3L3RY5sT8K4kyEnqhizwaqxLEbcYvpGrGPNEYRwtbCSUtL6YL86jdrvCbohnP5q8VxQ3qzGmt3W3iQJW97rD7m3';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Build directory under test. Overridable to check an alternate build, e.g. a dependency-bump branch's. */
export const LIB_DIR_OVERRIDE = process.env.WALLET_STANDARD_LIB_DIR;
export const LIB_DIR = LIB_DIR_OVERRIDE ? resolve(LIB_DIR_OVERRIDE) : resolve(ROOT, 'lib');

export const SOLANA_CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet'];

/**
 * A minimal `window` stand-in recording what src/register.ts does to it: one
 * dispatched registration event and one 'wallet-standard:app-ready' subscription.
 */
export function makeWindowStub() {
    const registered = [];
    const subscribed = [];

    return {
        registered,
        subscribed,
        addEventListener(type) {
            subscribed.push(type);
        },
        dispatchEvent(event) {
            if (event.type === 'wallet-standard:register-wallet') {
                event.detail({ register: (wallet) => (registered.push(wallet), () => {}) });
            }
            return true;
        },
    };
}

function makePublicKey(bytes, address) {
    return { toBytes: () => bytes.slice(), toBase58: () => address };
}

/**
 * A fake Brave provider matching the `BraveWallet` interface in src/window.ts.
 *
 * Starts *disconnected* on purpose: with a publicKey already present the wallet
 * constructor seeds an account via #connected(), and the later connect() becomes
 * a no-op that emits no 'change' event -- which would leave standard:events
 * untested. Starting empty makes connect() the thing that creates the account.
 */
function makeProviderStub() {
    const calls = [];
    const handlers = new Map();

    const provider = {
        calls,
        handlers,
        publicKey: null,
        on(event, listener, context) {
            handlers.set(event, listener.bind(context));
        },
        off(event) {
            handlers.delete(event);
        },
        async connect(options) {
            calls.push('connect');
            provider.publicKey = makePublicKey(PUBKEY_BYTES, ADDRESS);
            return { publicKey: provider.publicKey };
        },
        async disconnect() {
            calls.push('disconnect');
            provider.publicKey = null;
            handlers.get('disconnect')?.();
        },
        async signMessage() {
            calls.push('signMessage');
            return { signature: SIGNATURE_BYTES.slice() };
        },
        async signTransaction(transaction) {
            calls.push('signTransaction');
            return transaction;
        },
        async signAllTransactions(transactions) {
            calls.push('signAllTransactions');
            return transactions;
        },
        async signAndSendTransaction() {
            calls.push('signAndSendTransaction');
            return { signature: SEND_SIGNATURE_BS58 };
        },
    };

    return provider;
}

/**
 * A legacy transaction in wire format: one signature slot, a 1-key message with
 * no instructions. Enough to force VersionedTransaction.deserialize, which pulls
 * in @solana/buffer-layout, bn.js and buffer -- the CJS-interop heavy path where
 * a bundler regression actually bites.
 */
function legacyTxBytes() {
    return new Uint8Array([
        1, // signature count
        ...new Uint8Array(64), // signature
        1, // numRequiredSignatures
        0, // numReadonlySignedAccounts
        0, // numReadonlyUnsignedAccounts
        1, // account key count
        ...PUBKEY_BYTES,
        ...new Uint8Array(32), // recent blockhash
        0, // instruction count
    ]);
}

/** Resolves to the rejection's message, asserting it really was an Error. */
async function rejectionMessage(promise) {
    try {
        await promise;
        return null;
    } catch (error) {
        assert.ok(error instanceof Error, `expected an Error, got ${typeof error}: ${error}`);
        return error.message;
    }
}

/**
 * Drive every documented capability and return a snapshot to assert against.
 *
 * The caller supplies the window stub because the IIFE target has to hand the
 * same object to the bundle as it evaluates it.
 */
export async function exerciseWallet({ initialize }, win) {
    assert.equal(typeof initialize, 'function', 'initialize export is missing or not a function');

    const provider = makeProviderStub();
    initialize(provider);

    // registerWallet() swallows every error it hits (try/catch + console.error),
    // so a failed registration looks exactly like a successful one from the
    // caller's side. Assert on the observable effects instead.
    assert.equal(win.registered.length, 1, `expected exactly 1 registered wallet, got ${win.registered.length}`);

    const wallet = win.registered[0];
    const features = wallet.features;
    const snapshot = {
        name: wallet.name,
        version: wallet.version,
        chains: wallet.chains,
        iconPrefix: String(wallet.icon).slice(0, 26),
        walletFrozen: Object.isFrozen(wallet),
        // Each read must hand back a fresh copy rather than the internal array.
        chainsCopied: wallet.chains !== wallet.chains,
        subscribed: win.subscribed,
        features: Object.keys(features).sort(),
        featureVersions: Object.fromEntries(
            Object.entries(features)
                .map(([key, value]) => [key, value.version ?? null])
                .sort(([a], [b]) => a.localeCompare(b))
        ),
        supportedTransactionVersions: {
            signAndSendTransaction: features['solana:signAndSendTransaction'].supportedTransactionVersions,
            signTransaction: features['solana:signTransaction'].supportedTransactionVersions,
        },
        braveWalletPassthrough: features['braveWallet:'].braveWallet === provider,
        errors: {},
    };

    // Provider starts disconnected, so nothing is exposed until connect().
    snapshot.accountsBeforeConnect = wallet.accounts.length;
    snapshot.errors.beforeConnect = await rejectionMessage(
        features['solana:signTransaction'].signTransaction({
            account: { address: ADDRESS },
            transaction: legacyTxBytes(),
        })
    );

    const changeEvents = [];
    const unsubscribe = features['standard:events'].on('change', (properties) => {
        changeEvents.push(Object.keys(properties).sort().join(','));
    });

    const { accounts } = await features['standard:connect'].connect();
    snapshot.connectAccountCount = accounts.length;
    // connect() creates the account, so 'change' must have fired exactly once.
    snapshot.changeEventsAfterConnect = [...changeEvents];

    const account = accounts[0];
    snapshot.account = {
        address: account.address,
        chains: account.chains,
        features: account.features,
        publicKeyBytes: [...account.publicKey],
        publicKeyIsUint8Array: account.publicKey instanceof Uint8Array,
        frozen: Object.isFrozen(account),
        publicKeyCopied: account.publicKey !== account.publicKey,
    };

    const message = new TextEncoder().encode('brave wallet standard');
    const [signMessageOutput] = await features['solana:signMessage'].signMessage({ account, message });
    snapshot.signMessage = {
        signatureLength: signMessageOutput.signature.length,
        signedMessage: new TextDecoder().decode(signMessageOutput.signedMessage),
    };

    const [signTransactionOutput] = await features['solana:signTransaction'].signTransaction({
        account,
        transaction: legacyTxBytes(),
        chain: 'solana:mainnet',
    });
    snapshot.signTransaction = {
        byteLength: signTransactionOutput.signedTransaction.length,
        isUint8Array: signTransactionOutput.signedTransaction instanceof Uint8Array,
    };

    // >1 input takes the batch branch, which routes through signAllTransactions.
    const batch = await features['solana:signTransaction'].signTransaction(
        { account, transaction: legacyTxBytes(), chain: 'solana:mainnet' },
        { account, transaction: legacyTxBytes(), chain: 'solana:mainnet' }
    );
    snapshot.signTransactionBatch = batch.map((output) => output.signedTransaction.length);

    const [sendOutput] = await features['solana:signAndSendTransaction'].signAndSendTransaction({
        account,
        transaction: legacyTxBytes(),
        chain: 'solana:devnet',
        options: { skipPreflight: true },
    });
    snapshot.signAndSendTransaction = {
        // Proves bs58.decode survived bundling: 64 bytes, every one 0x02.
        signatureLength: sendOutput.signature.length,
        distinctSignatureBytes: [...new Set(sendOutput.signature)],
    };

    snapshot.errors.invalidAccount = await rejectionMessage(
        features['solana:signTransaction'].signTransaction({
            account: { ...account, address: 'other' },
            transaction: legacyTxBytes(),
        })
    );
    snapshot.errors.invalidChain = await rejectionMessage(
        features['solana:signTransaction'].signTransaction({
            account,
            transaction: legacyTxBytes(),
            chain: 'ethereum:1',
        })
    );
    snapshot.errors.conflictingChain = await rejectionMessage(
        features['solana:signTransaction'].signTransaction(
            { account, transaction: legacyTxBytes(), chain: 'solana:mainnet' },
            { account, transaction: legacyTxBytes(), chain: 'solana:devnet' }
        )
    );

    // Signing must not emit 'change'.
    snapshot.changeEventsAfterSigning = changeEvents.length;

    // 'accountChanged' -> #reconnected: a new key must replace the account and
    // emit 'change'. This is the third provider handler the wallet registers and
    // is otherwise never reached.
    provider.publicKey = makePublicKey(new Uint8Array(32).fill(9), ROTATED_ADDRESS);
    provider.handlers.get('accountChanged')?.();
    snapshot.afterAccountChanged = {
        address: wallet.accounts[0]?.address ?? null,
        changeEventCount: changeEvents.length,
    };

    unsubscribe();

    await features['standard:disconnect'].disconnect();
    snapshot.providerDisconnected = provider.publicKey === null;
    snapshot.accountsAfterDisconnect = wallet.accounts.length;
    // The listener was removed before disconnect, so the disconnect-driven
    // 'change' must not be delivered -- proves the unsubscribe actually works.
    snapshot.changeEventsAfterUnsubscribe = changeEvents.length;

    // With the provider disconnected, signing with the now-stale account must fail.
    snapshot.errors.afterDisconnect = await rejectionMessage(
        features['solana:signTransaction'].signTransaction({ account, transaction: legacyTxBytes() })
    );

    snapshot.providerCalls = provider.calls;

    return snapshot;
}
