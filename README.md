# wallet-standard-brave

This is modified from wallet-standard `ghost` example wallet following
https://github.com/solana-labs/wallet-standard/blob/master/WALLET.md

## Filing issues

Please file issues related to this repository in [Brave Browser repository](https://github.com/brave/brave-browser).

## Bumping this package

To bump this package do the following:
1. Update the dependencies to fix the alerts
2. run `npm run build`. Make sure the lib directory correctly generates an `index.iife.min.js` file, or it won't work with brave-core
3. run `npm run fmt`
4. push the updated version to github and merge to master, then tag it properly
5. Publish that version to npm and then use it in brave-core