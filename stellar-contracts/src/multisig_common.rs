//! Shared multisig validation / limits used by both the certificate contract
//! (`lib.rs`) and the standalone multisig contract (`multisig.rs`) (#1368).
//!
//! Keeping threshold / max-signer checks in one place prevents the copy-paste
//! drift that previously left `max_signers` uncapped in one of the two paths.

#![allow(dead_code)]

use soroban_sdk::{Address, Vec};

/// Maximum number of signers allowed in a certificate multisig config.
/// Aligned with Soroban per-transaction auth-entry practical limits (#1369).
pub const MAX_MULTISIG_SIGNERS: u32 = 20;

/// Validate threshold and signer-set size against `max_signers` and the global
/// hard cap. Panics with a stable message on invalid configuration (same
/// style as the previous inline checks).
pub fn validate_multisig_bounds(threshold: u32, signer_count: u32, max_signers: u32) {
    if threshold == 0 {
        panic!("Multisig threshold must be > 0");
    }
    if max_signers == 0 || max_signers > MAX_MULTISIG_SIGNERS {
        panic!("Multisig max_signers must be in 1..=MAX_MULTISIG_SIGNERS");
    }
    if max_signers < threshold {
        panic!("Multisig max_signers must be >= threshold");
    }
    if signer_count > max_signers {
        panic!("Multisig signer count exceeds max_signers");
    }
}

/// Validate a concrete signer vector (non-empty, unique, within bounds).
pub fn validate_signer_vector(signers: &Vec<Address>, threshold: u32, max_signers: u32) {
    let n = signers.len() as u32;
    if n == 0 {
        panic!("Multisig signers must not be empty");
    }
    validate_multisig_bounds(threshold, n, max_signers);

    // Reject duplicate signers.
    let mut i = 0u32;
    while i < signers.len() {
        let s = signers.get(i).unwrap();
        let mut j = i + 1;
        while j < signers.len() {
            if signers.get(j).unwrap() == s {
                panic!("Duplicate multisig signer");
            }
            j += 1;
        }
        i += 1;
    }
}
