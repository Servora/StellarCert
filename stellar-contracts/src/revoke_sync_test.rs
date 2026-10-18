#![cfg(test)]

extern crate std;

use super::*;
use crate::crl::CRLContractClient;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, String};

/// Register a certificate contract with `issuer` authorized, a CRL contract
/// that trusts the same issuer, and wire the two together.
fn setup() -> (Env, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);

    let cert_id = env.register_contract(None, CertificateContract);
    let cert = CertificateContractClient::new(&env, &cert_id);
    cert.initialize(&admin);
    cert.add_issuer(&issuer);

    let crl_id = env.register_contract(None, CRLContract);
    let crl = CRLContractClient::new(&env, &crl_id);
    crl.initialize(&issuer, &cert_id);

    cert.set_crl_contract(&crl_id);

    (env, issuer, owner, cert_id, crl_id)
}

fn issue(env: &Env, cert_id: &Address, issuer: &Address, owner: &Address, id: &str) -> String {
    let cert = CertificateContractClient::new(env, cert_id);
    let id = String::from_str(env, id);
    cert.issue_certificate(
        &id,
        issuer,
        owner,
        &String::from_str(env, "ipfs://QmTest"),
        &None,
    );
    id
}

// ─── Atomic revocation ────────────────────────────────────────────────────────

#[test]
fn revoke_mirrors_into_the_crl_in_the_same_call() {
    let (env, issuer, owner, cert_id, crl_id) = setup();
    let cert = CertificateContractClient::new(&env, &cert_id);
    let crl = CRLContractClient::new(&env, &crl_id);

    let id = issue(&env, &cert_id, &issuer, &owner, "cert-sync-1");
    assert!(!crl.is_revoked(&id));

    cert.revoke_certificate(&id, &String::from_str(&env, "Superseded"));

    // The main contract flips the status...
    assert_eq!(
        cert.get_certificate(&id).unwrap().status,
        CertificateStatus::Revoked
    );
    // ...and the CRL reflects it without a second issuer call.
    assert!(crl.is_revoked(&id));
    assert_eq!(crl.get_revoked_count(), 1);

    let info = crl.get_revocation_info(&id).unwrap();
    assert_eq!(info.reason, RevocationReason::Superseded as u32);
    assert_eq!(info.revoked_by, issuer);
}

#[test]
fn revoke_maps_common_reason_strings_onto_crl_codes() {
    let (env, issuer, owner, cert_id, crl_id) = setup();
    let cert = CertificateContractClient::new(&env, &cert_id);
    let crl = CRLContractClient::new(&env, &crl_id);

    let spaced = issue(&env, &cert_id, &issuer, &owner, "cert-reason-a");
    cert.revoke_certificate(&spaced, &String::from_str(&env, "Key Compromise"));
    assert_eq!(
        crl.get_revocation_info(&spaced).unwrap().reason,
        RevocationReason::KeyCompromise as u32
    );

    let snake = issue(&env, &cert_id, &issuer, &owner, "cert-reason-b");
    cert.revoke_certificate(&snake, &String::from_str(&env, "key_compromise"));
    assert_eq!(
        crl.get_revocation_info(&snake).unwrap().reason,
        RevocationReason::KeyCompromise as u32
    );

    let free_form = issue(&env, &cert_id, &issuer, &owner, "cert-reason-c");
    cert.revoke_certificate(&free_form, &String::from_str(&env, "Violation of terms"));
    assert_eq!(
        crl.get_revocation_info(&free_form).unwrap().reason,
        RevocationReason::Unspecified as u32
    );
}

// ─── Backwards compatibility ──────────────────────────────────────────────────

#[test]
fn revoke_without_a_configured_crl_still_works() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);

    let cert_id = env.register_contract(None, CertificateContract);
    let cert = CertificateContractClient::new(&env, &cert_id);
    cert.initialize(&admin);
    cert.add_issuer(&issuer);

    assert_eq!(cert.get_crl_contract(), None);

    let id = issue(&env, &cert_id, &issuer, &owner, "cert-no-crl");
    cert.revoke_certificate(&id, &String::from_str(&env, "Superseded"));

    assert_eq!(
        cert.get_certificate(&id).unwrap().status,
        CertificateStatus::Revoked
    );
}

// ─── Failure atomicity ────────────────────────────────────────────────────────

/// Stands in for a CRL that rejects the mirrored revocation.
#[contract]
struct RejectingCrlStub;

#[contractimpl]
impl RejectingCrlStub {
    pub fn revoke_certificate_mirrored(
        _env: Env,
        _issuer: Address,
        _certificate_id: String,
        _reason: RevocationReason,
        _serial_number: Option<String>,
    ) {
        panic!("CRL rejected the mirrored revocation");
    }
}

#[test]
fn revoke_reverts_when_the_crl_rejects_the_mirrored_call() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);

    let cert_id = env.register_contract(None, CertificateContract);
    let cert = CertificateContractClient::new(&env, &cert_id);
    cert.initialize(&admin);
    cert.add_issuer(&issuer);

    let crl_id = env.register_contract(None, RejectingCrlStub);
    cert.set_crl_contract(&crl_id);

    let id = issue(&env, &cert_id, &issuer, &owner, "cert-revert");

    let outcome = cert.try_revoke_certificate(&id, &String::from_str(&env, "Superseded"));
    assert!(outcome.is_err(), "mirrored revocation should have failed");

    // Nothing is left half-applied: the certificate is still active.
    assert_eq!(
        cert.get_certificate(&id).unwrap().status,
        CertificateStatus::Active
    );
}
