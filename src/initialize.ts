// This is copied from @brave/wallet-standard-brave with modifications

import { registerWallet } from './register.js';
import { VeeraWalletWallet } from './wallet.js';
import type { VeeraWallet } from './window.js';

export function initialize(veeraWallet: VeeraWallet): void {
    registerWallet(new VeeraWalletWallet(veeraWallet));
}
