#!/bin/bash

# Soroban Contract Deployment Script
# This script deploys the StellarCert Soroban contracts to the Stellar network

set -e

# Configuration
NETWORK="${STELLAR_NETWORK:-testnet}"
ADMIN_SECRET="${SOROBAN_ADMIN_SECRET}"
RPC_URL="${SOROBAN_RPC_URL}"

if [ -z "$ADMIN_SECRET" ]; then
    echo "Error: SOROBAN_ADMIN_SECRET environment variable is required"
    exit 1
fi

if [ -z "$RPC_URL" ]; then
    if [ "$NETWORK" = "testnet" ]; then
        RPC_URL="https://soroban-testnet.stellar.org"
    else
        RPC_URL="https://soroban.stellar.org"
    fi
fi

echo "Deploying contracts to $NETWORK network..."
echo "RPC URL: $RPC_URL"

# Build the contracts
echo "Building contracts..."
cd stellar-contracts
cargo build --target wasm32-unknown-unknown --release

# Deploy certificate contract
echo "Deploying certificate contract..."
CERT_WASM_HASH=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/certificate_revocation.wasm \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

echo "Certificate contract deployed with WASM hash: $CERT_WASM_HASH"

# Create certificate contract instance
CERT_CONTRACT_ID=$(soroban contract deploy \
    --wasm-hash "$CERT_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

echo "Certificate contract instance created with ID: $CERT_CONTRACT_ID"

# Initialize certificate contract
#
# SECURITY (#1022): deploy and initialize are two separate transactions, so
# there is a window between them in which anyone can call `initialize` and
# claim admin. `initialize` now requires the admin address's authorization,
# which stops a third party initializing on the real admin's behalf — but an
# attacker can still authorize their OWN address and win the race.
#
# Closing the window entirely requires deploying with a constructor
# (`soroban contract deploy ... -- --admin <ADDR>` against a contract that
# defines `__constructor`). That is a breaking change to every contract
# registration in the test suite, so it is deliberately left as a follow-up.
#
# Until then: verify the admin after deploying, and treat a mismatch as a
# compromised deployment.
echo "Initializing certificate contract..."
ADMIN_ADDRESS=$(soroban keys address "$ADMIN_SECRET")

soroban contract invoke \
    --id "$CERT_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    -- \
    initialize \
    --admin "$ADMIN_ADDRESS"

# Confirm the admin we intended is the admin that was stored. If someone won
# the race above, this is where the deployment is caught.
STORED_ADMIN=$(soroban contract invoke \
    --id "$CERT_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    -- \
    get_admin 2>/dev/null | tr -d '"' | tail -1)

if [ -n "$STORED_ADMIN" ] && [ "$STORED_ADMIN" != "$ADMIN_ADDRESS" ]; then
    echo "FATAL: contract admin is $STORED_ADMIN, expected $ADMIN_ADDRESS." >&2
    echo "The initialize call was front-run. Do not use this deployment." >&2
    exit 1
fi

echo "Certificate contract initialized successfully!"

# Deploy multisig contract (if needed)
echo "Deploying multisig contract..."
MULTISIG_WASM_HASH=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/certificate_revocation.wasm \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

MULTISIG_CONTRACT_ID=$(soroban contract deploy \
    --wasm-hash "$MULTISIG_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

echo "Multisig contract deployed with ID: $MULTISIG_CONTRACT_ID"

# Deploy CRL contract (if needed)
echo "Deploying CRL contract..."
CRL_WASM_HASH=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/certificate_revocation.wasm \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

CRL_CONTRACT_ID=$(soroban contract deploy \
    --wasm-hash "$CRL_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    | tail -1)

echo "CRL contract deployed with ID: $CRL_CONTRACT_ID"

# Initialize the CRL and link it to the certificate contract so that
# CertificateContract.revoke_certificate mirrors the revocation into the CRL in
# the same transaction. The CRL issuer must be the same address that issues
# certificates, otherwise the mirrored revocation is rejected.
echo "Initializing CRL contract..."
soroban contract invoke \
    --id "$CRL_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    -- \
    initialize \
    --issuer "$ADMIN_ADDRESS" \
    --certificate_contract "$CERT_CONTRACT_ID"

echo "Linking certificate contract to CRL..."
soroban contract invoke \
    --id "$CERT_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$(soroban config network pass $NETWORK)" \
    -- \
    set_crl_contract \
    --crl_contract "$CRL_CONTRACT_ID"

echo "Certificate contract linked to CRL successfully!"

# Output configuration
echo ""
echo "=== DEPLOYMENT COMPLETE ==="
echo "Add these to your .env file:"
echo "SOROBAN_RPC_URL=$RPC_URL"
echo "CERTIFICATE_CONTRACT_ID=$CERT_CONTRACT_ID"
echo "MULTISIG_CONTRACT_ID=$MULTISIG_CONTRACT_ID"
echo "CRL_CONTRACT_ID=$CRL_CONTRACT_ID"
echo "SOROBAN_ADMIN_SECRET=$ADMIN_SECRET"
echo "ENABLE_SOROBAN_INTEGRATION=true"
echo ""
echo "Admin address: $ADMIN_ADDRESS"