#!/usr/bin/env bash
# Build every deployable contract to its own WASM file.
#
# All four contracts live in this one crate, and they share exported function
# names (initialize, revoke_certificate, approve_request, ...). A WASM module
# can export each name only once, so the crate is built once per contract with
# exactly one contract feature enabled (see Cargo.toml). Each build overwrites
# target/wasm32v1-none/release/certificate_revocation.wasm, so it is copied out
# under the contract's name before the next build starts.
#
# Output: target/contracts/{certificate,multisig,crl,admin-multisig}.wasm
#
# Usage: ./build-contracts.sh [contract ...]   (default: all four)
set -euo pipefail

cd "$(dirname "$0")"

CONTRACTS=("$@")
if [ ${#CONTRACTS[@]} -eq 0 ]; then
    CONTRACTS=(certificate multisig crl admin-multisig)
fi

BUILD_OUTPUT=target/wasm32v1-none/release/certificate_revocation.wasm
OUT_DIR=target/contracts
mkdir -p "$OUT_DIR"

for contract in "${CONTRACTS[@]}"; do
    echo "Building $contract contract..."
    stellar contract build --no-default-features --features "$contract"
    cp "$BUILD_OUTPUT" "$OUT_DIR/$contract.wasm"
    echo "  -> $OUT_DIR/$contract.wasm"
done
