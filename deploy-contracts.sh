#!/bin/bash

# Soroban Contract Deployment Script
# This script deploys the StellarCert Soroban contracts to the Stellar network

set -e

# Configuration
NETWORK="${STELLAR_NETWORK:-testnet}"
ADMIN_SECRET="${SOROBAN_ADMIN_SECRET}"
RPC_URL="${SOROBAN_RPC_URL}"
NETWORK_PASSPHRASE="${SOROBAN_NETWORK_PASSPHRASE}"
ADMIN_SIGNER_ADDRESSES="${SOROBAN_ADMIN_SIGNERS}"
ADMIN_THRESHOLD="${SOROBAN_ADMIN_THRESHOLD:-2}"
ADMIN_PROPOSAL_WINDOW="${SOROBAN_ADMIN_PROPOSAL_WINDOW:-100}"

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

if [ -z "$NETWORK_PASSPHRASE" ]; then
    case "$NETWORK" in
        testnet)
            NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
            ;;
        mainnet|public)
            NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
            ;;
        *)
            echo "Error: set SOROBAN_NETWORK_PASSPHRASE for custom networks"
            exit 1
            ;;
    esac
fi

if [ -z "$ADMIN_SIGNER_ADDRESSES" ]; then
    echo "Error: SOROBAN_ADMIN_SIGNERS must contain comma-separated signer addresses"
    exit 1
fi

if ! [[ "$ADMIN_THRESHOLD" =~ ^[0-9]+$ ]] ||
    ! [[ "$ADMIN_PROPOSAL_WINDOW" =~ ^[0-9]+$ ]]; then
    echo "Error: SOROBAN_ADMIN_THRESHOLD and SOROBAN_ADMIN_PROPOSAL_WINDOW must be positive integers"
    exit 1
fi

IFS=',' read -r -a ADMIN_SIGNERS <<< "$ADMIN_SIGNER_ADDRESSES"
if [ "${#ADMIN_SIGNERS[@]}" -lt 2 ] ||
    [ "$ADMIN_THRESHOLD" -lt 2 ] ||
    [ "$ADMIN_THRESHOLD" -gt "${#ADMIN_SIGNERS[@]}" ] ||
    [ "$ADMIN_PROPOSAL_WINDOW" -eq 0 ]; then
    echo "Error: configure at least two signers, a threshold between 2 and the signer count, and a positive proposal window"
    exit 1
fi

ADMIN_SIGNERS_JSON="["
VALIDATED_ADMIN_SIGNERS=()
for signer in "${ADMIN_SIGNERS[@]}"; do
    if ! [[ "$signer" =~ ^G[A-Z2-7]{55}$ ]]; then
        echo "Error: SOROBAN_ADMIN_SIGNERS contains an invalid Stellar account address"
        exit 1
    fi
    for existing_signer in "${VALIDATED_ADMIN_SIGNERS[@]}"; do
        if [ "$signer" = "$existing_signer" ]; then
            echo "Error: SOROBAN_ADMIN_SIGNERS must not contain duplicate addresses"
            exit 1
        fi
    done
    VALIDATED_ADMIN_SIGNERS+=("$signer")
    if [ "$ADMIN_SIGNERS_JSON" != "[" ]; then
        ADMIN_SIGNERS_JSON+=","
    fi
    ADMIN_SIGNERS_JSON+="\"$signer\""
done
ADMIN_SIGNERS_JSON+="]"
ADMIN_BOOTSTRAP_SIGNER="${ADMIN_SIGNERS[0]}"

echo "Deploying contracts to $NETWORK network..."
echo "RPC URL: $RPC_URL"

# Build the contracts
echo "Building contracts..."
cd stellar-contracts
# One WASM per contract (they share exported names, so they cannot share one
# module): target/contracts/<contract>.wasm
./build-contracts.sh certificate multisig crl admin-multisig

# Deploy and initialize the admin multisig first. The CLI must have signing
# identities configured for every address in SOROBAN_ADMIN_SIGNERS.
echo "Deploying admin multisig contract..."
ADMIN_MULTISIG_WASM_HASH=$(stellar contract deploy \
    --wasm target/contracts/admin-multisig.wasm \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    | tail -1)

ADMIN_MULTISIG_CONTRACT_ID=$(stellar contract deploy \
    --wasm-hash "$ADMIN_MULTISIG_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    | tail -1)

echo "Initializing admin multisig contract..."
stellar contract invoke \
    --id "$ADMIN_MULTISIG_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    init_admin_multisig \
    --threshold "$ADMIN_THRESHOLD" \
    --signers "$ADMIN_SIGNERS_JSON" \
    --proposal_window "$ADMIN_PROPOSAL_WINDOW"

echo "Admin multisig contract initialized with ID: $ADMIN_MULTISIG_CONTRACT_ID"

# Deploy certificate contract
echo "Deploying certificate contract..."
CERT_WASM_HASH=$(stellar contract deploy \
    --wasm target/contracts/certificate.wasm \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    | tail -1)

echo "Certificate contract deployed with WASM hash: $CERT_WASM_HASH"

# Create certificate contract instance
CERT_CONTRACT_ID=$(stellar contract deploy \
    --wasm-hash "$CERT_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    | tail -1)

echo "Certificate contract instance created with ID: $CERT_CONTRACT_ID"

# Configure the certificate contract on the multisig, then initialize the
# certificate from the multisig contract so its address can authorize itself.
echo "Configuring certificate contract on admin multisig..."
ADMIN_ADDRESS=$(stellar keys address "$ADMIN_SECRET")

stellar contract invoke \
    --id "$ADMIN_MULTISIG_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    set_admin_certificate_contract \
    --signer "$ADMIN_BOOTSTRAP_SIGNER" \
    --certificate_contract "$CERT_CONTRACT_ID"

stellar contract invoke \
    --id "$ADMIN_MULTISIG_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    initialize_certificate_contract \
    --signer "$ADMIN_BOOTSTRAP_SIGNER"

# Confirm the admin multisig is the certificate contract's stored admin.
STORED_ADMIN=$(stellar contract invoke \
    --id "$CERT_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    get_admin 2>/dev/null | tr -d '"' | tail -1)

if [ "$STORED_ADMIN" != "$ADMIN_MULTISIG_CONTRACT_ID" ]; then
    echo "FATAL: contract admin is $STORED_ADMIN, expected $ADMIN_MULTISIG_CONTRACT_ID." >&2
    exit 1
fi

echo "Certificate contract initialized successfully!"

# Deploy multisig contract (if needed)
echo "Deploying multisig contract..."
MULTISIG_WASM_HASH=$(stellar contract deploy \
    --wasm target/contracts/multisig.wasm \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    | tail -1)

MULTISIG_CONTRACT_ID=$(stellar contract deploy \
    --wasm-hash "$MULTISIG_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    | tail -1)

echo "Multisig contract deployed with ID: $MULTISIG_CONTRACT_ID"

# Deploy CRL contract (if needed)
echo "Deploying CRL contract..."
CRL_WASM_HASH=$(stellar contract deploy \
    --wasm target/contracts/crl.wasm \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    | tail -1)

CRL_CONTRACT_ID=$(stellar contract deploy \
    --wasm-hash "$CRL_WASM_HASH" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    | tail -1)

echo "CRL contract deployed with ID: $CRL_CONTRACT_ID"

# Initialize the CRL and link it to the certificate contract so that
# CertificateContract.revoke_certificate mirrors the revocation into the CRL in
# the same transaction. The CRL issuer must be the same address that issues
# certificates, otherwise the mirrored revocation is rejected.
echo "Initializing CRL contract..."
stellar contract invoke \
    --id "$CRL_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    -- \
    initialize \
    --issuer "$ADMIN_ADDRESS" \
    --certificate_contract "$CERT_CONTRACT_ID"

echo "Linking certificate contract to CRL..."
stellar contract invoke \
    --id "$CERT_CONTRACT_ID" \
    --source "$ADMIN_SECRET" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
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
echo "ADMIN_MULTISIG_CONTRACT_ID=$ADMIN_MULTISIG_CONTRACT_ID"
echo "MULTISIG_CONTRACT_ID=$MULTISIG_CONTRACT_ID"
echo "CRL_CONTRACT_ID=$CRL_CONTRACT_ID"
echo "SOROBAN_ADMIN_SECRET=<the admin secret you supplied via SOROBAN_ADMIN_SECRET; never log or commit it>"
echo "ENABLE_SOROBAN_INTEGRATION=true"
echo ""
echo "Certificate admin multisig address: $ADMIN_MULTISIG_CONTRACT_ID"
echo "Deployment account address: $ADMIN_ADDRESS"
