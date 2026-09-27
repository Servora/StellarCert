#![cfg(test)]

extern crate std;

use super::crl::*;
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Events},
    vec, Address, Env, IntoVal, String, Val, Vec,
};
use std::string::ToString;

// ─── Helpers ─────────────────────────────────────────────────────────────────

#[contract]
struct CertificateExistsStub;

#[contractimpl]
impl CertificateExistsStub {
    pub fn certificate_exists(_env: Env, _id: String) -> bool {
        true
    }
}

/// Register a minimal stub that satisfies `certificate_exists` cross-contract
/// calls made by `revoke_certificate`.
fn register_cert_stub(env: &Env) -> Address {
    env.register_contract(None, CertificateExistsStub)
}

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let cert_contract = register_cert_stub(&env);
    (env, issuer, cert_contract)
}

fn make_client(env: &Env) -> (Address, CRLContractClient<'_>) {
    let contract_id = env.register_contract(None, CRLContract);
    let client = CRLContractClient::new(env, &contract_id);
    (contract_id, client)
}

// ─── Initialization ───────────────────────────────────────────────────────────

#[test]
fn test_crl_initialization() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);

    client.initialize(&issuer, &cert_contract);

    let crl = client.get_crl_info();
    assert_eq!(crl.issuer, issuer);
    assert_eq!(crl.revoked_count, 0);
    assert_eq!(crl.crl_number, 1);
    // merkle_root should be the SHA-256 of an empty byte string, hex-encoded
    // (64 hex chars)
    assert_eq!(crl.merkle_root.len(), 64);
}

#[test]
#[should_panic(expected = "CRL already initialized")]
fn test_double_initialize_panics() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);

    client.initialize(&issuer, &cert_contract);
    client.initialize(&issuer, &cert_contract); // must panic
}

// ─── Revocation ───────────────────────────────────────────────────────────────

#[test]
fn test_revoke_certificate() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    // Mock the cross-contract `certificate_exists` call to return true.
    // (mock_all_auths already handles auth; we need to mock the return value.)
    env.mock_all_auths();

    let cert_id = String::from_str(&env, "CERT-001");
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);

    assert!(client.is_revoked(&cert_id));

    let info = client.get_revocation_info(&cert_id).unwrap();
    assert_eq!(info.certificate_id, cert_id);
    assert_eq!(info.reason, RevocationReason::KeyCompromise as u32);
    assert_eq!(info.issuer, issuer);

    let crl = client.get_crl_info();
    assert_eq!(crl.revoked_count, 1);
    assert_eq!(crl.crl_number, 2); // incremented by refresh_crl_info
}

#[test]
fn test_revoke_certificate_emits_crl_revocation_added_event() {
    let (env, issuer, cert_contract) = setup();
    let (contract_id, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let cert_id = String::from_str(&env, "CERT-EVT-001");
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);

    let mut topics: Vec<Val> = Vec::new(&env);
    topics.push_back(symbol_short!("crl_add").into_val(&env));
    topics.push_back(cert_id.clone().into_val(&env));

    let payload = CRLRevocationAddedEvent {
        certificate_id: cert_id.clone(),
        reason: RevocationReason::KeyCompromise as u32,
        issuer: issuer.clone(),
        revocation_date: env.ledger().timestamp(),
        revoked_by: issuer.clone(),
        revoked_count: 1,
        crl_number: 2,
    };

    let expected: Vec<(Address, Vec<Val>, Val)> =
        vec![&env, (contract_id.clone(), topics, payload.into_val(&env))];

    assert_eq!(env.events().all(), expected);
}

#[test]
fn test_non_revoked_certificate_returns_false() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let cert_id = String::from_str(&env, "CERT-999");
    assert!(!client.is_revoked(&cert_id));
    assert!(client.get_revocation_info(&cert_id).is_none());
}

#[test]
#[should_panic(expected = "Certificate already revoked")]
fn test_duplicate_revocation_panics() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let cert_id = String::from_str(&env, "CERT-001");
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);
}

#[test]
fn test_revoke_multiple_certificates() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let cert1 = String::from_str(&env, "CERT-001");
    let cert2 = String::from_str(&env, "CERT-002");
    let cert3 = String::from_str(&env, "CERT-003");

    client.revoke_certificate(&issuer, &cert1, &RevocationReason::KeyCompromise, &None);
    client.revoke_certificate(&issuer, &cert2, &RevocationReason::CACompromise, &None);
    client.revoke_certificate(&issuer, &cert3, &RevocationReason::Superseded, &None);

    assert!(client.is_revoked(&cert1));
    assert!(client.is_revoked(&cert2));
    assert!(client.is_revoked(&cert3));
    assert_eq!(client.get_revoked_count(), 3);
    assert_eq!(client.get_crl_info().crl_number, 4);
}

// ─── Verification ─────────────────────────────────────────────────────────────

#[test]
fn test_verify_certificate_not_revoked() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let cert_id = String::from_str(&env, "CERT-001");
    let (is_revoked, crl_number) = client.verify_certificate(&cert_id);
    assert!(!is_revoked);
    assert_eq!(crl_number, 1);
}

#[test]
fn test_verify_certificate_after_revocation() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let cert_id = String::from_str(&env, "CERT-001");
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);

    let (is_revoked, crl_number) = client.verify_certificate(&cert_id);
    assert!(is_revoked);
    assert_eq!(crl_number, 2);
}

// ─── Merkle root ─────────────────────────────────────────────────────────────

#[test]
fn test_merkle_root_is_64_hex_chars() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let root = client.get_merkle_root();
    // SHA-256 hex digest is always 64 lower-case hex characters
    assert_eq!(root.len(), 64);
}

#[test]
fn test_merkle_root_changes_on_revocation() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let root_before = client.get_merkle_root();

    client.revoke_certificate(
        &issuer,
        &String::from_str(&env, "CERT-001"),
        &RevocationReason::KeyCompromise,
        &None,
    );
    let root_after_one = client.get_merkle_root();
    assert_ne!(root_before, root_after_one);

    client.revoke_certificate(
        &issuer,
        &String::from_str(&env, "CERT-002"),
        &RevocationReason::KeyCompromise,
        &None,
    );
    let root_after_two = client.get_merkle_root();
    assert_ne!(root_after_one, root_after_two);
}

#[test]
fn test_merkle_root_is_deterministic() {
    // Two independently-built CRLs with the same set of IDs must produce the
    // same root.
    let (env, issuer, cert_contract) = setup();

    let (_, client_a) = make_client(&env);
    let (_, client_b) = make_client(&env);

    let cert_contract2 = register_cert_stub(&env);
    let issuer2 = Address::generate(&env);

    client_a.initialize(&issuer, &cert_contract);
    client_b.initialize(&issuer2, &cert_contract2);

    let ids = ["ALPHA", "BETA", "GAMMA"];
    for id in ids {
        let s = String::from_str(&env, id);
        client_a.revoke_certificate(&issuer, &s, &RevocationReason::KeyCompromise, &None);
        client_b.revoke_certificate(&issuer2, &s, &RevocationReason::KeyCompromise, &None);
    }

    assert_eq!(client_a.get_merkle_root(), client_b.get_merkle_root());
}

#[test]
fn test_merkle_root_odd_number_of_leaves() {
    // Odd leaf count triggers the "duplicate last leaf" branch in the tree.
    // Result must still be a valid 64-char hex string and differ from even.
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    for i in 0u32..3 {
        let s = soroban_sdk::String::from_str(&env, &["ID-", &i.to_string()].concat());
        client.revoke_certificate(&issuer, &s, &RevocationReason::Superseded, &None);
    }
    let root_odd = client.get_merkle_root();
    assert_eq!(root_odd.len(), 64);

    client.revoke_certificate(
        &issuer,
        &String::from_str(&env, "ID-3"),
        &RevocationReason::Superseded,
        &None,
    );
    let root_even = client.get_merkle_root();
    assert_eq!(root_even.len(), 64);
    assert_ne!(root_odd, root_even);
}

// ─── Pagination ───────────────────────────────────────────────────────────────

#[test]
fn test_get_revoked_certificates_pagination() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    for i in 0u32..7 {
        let s = soroban_sdk::String::from_str(&env, &["CERT-", &i.to_string()].concat());
        client.revoke_certificate(&issuer, &s, &RevocationReason::KeyCompromise, &None);
    }

    let page0 = client.get_revoked_certificates(&0, &3);
    assert_eq!(page0.len(), 3);

    let page1 = client.get_revoked_certificates(&1, &3);
    assert_eq!(page1.len(), 3);

    let page2 = client.get_revoked_certificates(&2, &3);
    assert_eq!(page2.len(), 1); // only 1 left

    let page3 = client.get_revoked_certificates(&3, &3);
    assert_eq!(page3.len(), 0); // beyond end
}

#[test]
fn test_get_revoked_certificates_zero_limit() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    client.revoke_certificate(
        &issuer,
        &String::from_str(&env, "CERT-001"),
        &RevocationReason::KeyCompromise,
        &None,
    );

    let result = client.get_revoked_certificates(&0, &0);
    assert_eq!(result.len(), 0);
}

// ─── CRL metadata update ──────────────────────────────────────────────────────

#[test]
fn test_update_crl_metadata_changes_next_update() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let original = client.get_crl_info().next_update;
    let new_next = original + 3600;

    client.update_crl_metadata(&Some(new_next), &None);

    let updated = client.get_crl_info();
    assert_eq!(updated.next_update, new_next);
    assert_eq!(updated.crl_number, 2); // refresh_crl_info increments
}

#[test]
fn test_update_crl_metadata_none_preserves_next_update() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let original = client.get_crl_info().next_update;
    client.update_crl_metadata(&None, &None);

    assert_eq!(client.get_crl_info().next_update, original);
}

#[test]
fn test_needs_update_false_after_init() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    assert!(!client.needs_update());
}

// ─── Admin ────────────────────────────────────────────────────────────────────

#[test]
fn test_set_admin_allows_revocation() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let admin = Address::generate(&env);
    client.set_admin(&admin);

    // Admin should now be able to revoke (auth is mocked for all)
    let cert_id = String::from_str(&env, "CERT-001");
    client.revoke_certificate(
        &admin,
        &cert_id,
        &RevocationReason::AffiliationChanged,
        &None,
    );
    assert!(client.is_revoked(&cert_id));
}
