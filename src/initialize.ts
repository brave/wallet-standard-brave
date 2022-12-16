import { registerWallet } from './register.js';
import { BraveWalletWallet } from './wallet.js';
import type { BraveWallet } from './window.js';

export function initialize(braveWallet: BraveWallet): void {
    registerWallet(new BraveWalletWallet(braveWallet));
}
