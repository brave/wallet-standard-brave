# wallet-standard-brave

[![Build](https://github.com/brave/wallet-standard-brave/actions/workflows/pull_request.yml/badge.svg)](https://github.com/brave/wallet-standard-brave/actions/workflows/pull_request.yml)
[![CodeQL](https://github.com/brave/wallet-standard-brave/actions/workflows/codeql.yml/badge.svg)](https://github.com/brave/wallet-standard-brave/actions/workflows/codeql.yml)
[![npm](https://img.shields.io/npm/v/@brave/wallet-standard-brave)](https://www.npmjs.com/package/@brave/wallet-standard-brave)

This is modified from wallet-standard `ghost` example wallet following
https://github.com/solana-labs/wallet-standard/blob/master/WALLET.md

## Filing issues

Please file issues related to this repository in [Brave Browser repository](https://github.com/brave/brave-browser).

## Releasing a new version

Publishing to npm is automated by the [Publish workflow](.github/workflows/publish.yml),
which runs with provenance on every GitHub release. To cut a release, bump the
`version` in `package.json`, merge to `master`, then create a GitHub release with a
matching `v<version>` tag (the workflow fails on a mismatch). Once published, update
brave-core to use the new version.
