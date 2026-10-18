#![cfg(test)]

extern crate std;

use super::crl::*;
use soroban_sdk::{
    contract, contractimpl, testutils::Address as _, testutils::Events as _, Address, Env,
    IntoVal, String, Symbol, Val,
};
use std::string::ToString;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Build the data payload the pre-`#[contractevent]` implementation emitted.
///
/// `CRLRevocationAddedEvent` used to be a `#[contracttype]` struct, which
/// Soroban encodes as a map keyed by the field-name symbols;
/// `#[contractevent]`'s default `data_format = "map"` renders the same shape.
fn legacy_payload(env: &Env, fields: &[(&str, Val)]) -> Val {
    let mut payload = soroban_sdk::Map::new(env);
    for (key, value) in fields {
        payload.set(Symbol::new(env, key), *value);
    }
    payload.into_val(env)
}

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
    env.register(CertificateExistsStub, ())
}

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let issuer = Address::generate(&env);
    let cert_contract = register_cert_stub(&env);
    (env, issuer, cert_contract)
}

fn make_client(env: &Env) -> (Address, CRLContractClient<'_>) {
    let contract_id = env.register(CRLContract, ());
    let client = CRLContractClient::new(env, &contract_id);
    (contract_id, client)
}

// ─── Initialization ───────────────────────────────────────────────────────────

#[test]
fn test_crl_initialization() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);

    env.mock_all_auths();
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

    env.mock_all_auths();
    client.initialize(&issuer, &cert_contract);
    env.mock_all_auths();
    client.initialize(&issuer, &cert_contract); // must panic
}

// ─── Revocation ───────────────────────────────────────────────────────────────

#[test]
fn test_revoke_certificate() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    env.mock_all_auths();
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
fn test_non_revoked_certificate_returns_false() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    env.mock_all_auths();
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
    env.mock_all_auths();
    client.initialize(&issuer, &cert_contract);

    let cert_id = String::from_str(&env, "CERT-001");
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);
}

#[test]
fn test_revoke_multiple_certificates() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    env.mock_all_auths();
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
    env.mock_all_auths();
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
    env.mock_all_auths();
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
    env.mock_all_auths();
    client.initialize(&issuer, &cert_contract);

    let root = client.get_merkle_root();
    // SHA-256 hex digest is always 64 lower-case hex characters
    assert_eq!(root.len(), 64);
}

#[test]
fn test_merkle_root_changes_on_revocation() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    env.mock_all_auths();
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
    env.mock_all_auths();
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
    env.mock_all_auths();
    client.initialize(&issuer, &cert_contract);

    for i in 0u32..7 {
        let s = soroban_sdk::String::from_str(&env, &["CERT-", &i.to_string()].concat());
        client.revoke_certificate(&issuer, &s, &RevocationReason::KeyCompromise, &None);
    }

    // Pagination is 1-indexed: page 1 is the first page. A `page` of 0 is
    // normalized to the first page, matching the certificate contract's
    // listings.
    let page1 = client.get_revoked_certificates(&1, &3);
    assert_eq!(page1.len(), 3);
    assert_eq!(page1.get(0).unwrap().certificate_id, String::from_str(&env, "CERT-0"));

    let page2 = client.get_revoked_certificates(&2, &3);
    assert_eq!(page2.len(), 3);
    assert_eq!(page2.get(0).unwrap().certificate_id, String::from_str(&env, "CERT-3"));

    let page3 = client.get_revoked_certificates(&3, &3);
    assert_eq!(page3.len(), 1); // only 1 left

    let page4 = client.get_revoked_certificates(&4, &3);
    assert_eq!(page4.len(), 0); // beyond end

    // Page 0 is normalized to the first page (saturating), not skipped.
    let page0 = client.get_revoked_certificates(&0, &3);
    assert_eq!(page0.len(), 3);
    assert_eq!(page0.get(0).unwrap().certificate_id, String::from_str(&env, "CERT-0"));
}

#[test]
fn test_get_revoked_certificates_limit_cap() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    env.mock_all_auths();
    client.initialize(&issuer, &cert_contract);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.get_revoked_certificates(&1, &101)
    }));
    assert!(result.is_err(), "limit above MAX_PAGE_SIZE should panic");
}

#[test]
fn test_get_revoked_certificates_zero_limit() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    env.mock_all_auths();
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
    env.mock_all_auths();
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
    env.mock_all_auths();
    client.initialize(&issuer, &cert_contract);

    let original = client.get_crl_info().next_update;
    client.update_crl_metadata(&None, &None);

    assert_eq!(client.get_crl_info().next_update, original);
}

#[test]
fn test_update_crl_metadata_issuer_authorizes() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let original = client.get_crl_info().next_update;
    let new_next = original + 3600;

    // The CRL owner may authorize the update explicitly.
    client.update_crl_metadata(&Some(new_next), &Some(issuer.clone()));

    assert_eq!(client.get_crl_info().next_update, new_next);
}

#[test]
fn test_update_crl_metadata_admin_authorizes() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let admin = Address::generate(&env);
    client.set_admin(&admin);

    let original = client.get_crl_info().next_update;
    let new_next = original + 3600;

    // A configured admin is also an authorized issuer for metadata updates.
    client.update_crl_metadata(&Some(new_next), &Some(admin.clone()));

    assert_eq!(client.get_crl_info().next_update, new_next);
}

#[test]
#[should_panic(expected = "Only issuer or admin can update CRL metadata")]
fn test_update_crl_metadata_unauthorized_panics() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let stranger = Address::generate(&env);
    client.update_crl_metadata(&Some(1), &Some(stranger));
}

#[test]
fn test_needs_update_false_after_init() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    env.mock_all_auths();
    client.initialize(&issuer, &cert_contract);

    assert!(!client.needs_update());
}

// ─── Admin ────────────────────────────────────────────────────────────────────

#[test]
fn test_set_admin_allows_revocation() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    env.mock_all_auths();
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

// ─── Revocation events ────────────────────────────────────────────────────────

/// The exact event published by `revoke_certificate`, matched topic by topic and
/// field by field. Backend webhooks and indexers key off this shape, so it is
/// asserted literally rather than by counting events.
#[test]
fn test_revoke_certificate_emits_revocation_added_event() {
    use soroban_sdk::{symbol_short, vec, IntoVal};

    let (env, issuer, cert_contract) = setup();
    let (contract_id, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let cert_id = String::from_str(&env, "CERT-001");
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);

    // `all()` only reflects the most recent contract invocation, so the event
    // list is captured before any further call to the contract.
    let emitted = env.events().all();

    let crl = client.get_crl_info();
    let expected_payload = legacy_payload(
        &env,
        &[
            ("certificate_id", cert_id.clone().into_val(&env)),
            ("reason", (RevocationReason::KeyCompromise as u32).into_val(&env)),
            ("revoked_by", issuer.clone().into_val(&env)),
            ("revocation_date", env.ledger().timestamp().into_val(&env)),
            ("revoked_count", crl.revoked_count.into_val(&env)),
            ("crl_number", crl.crl_number.into_val(&env)),
            ("merkle_root", crl.merkle_root.clone().into_val(&env)),
            ("this_update", crl.this_update.into_val(&env)),
            ("next_update", crl.next_update.into_val(&env)),
        ],
    );

    let expected = vec![
        &env,
        (
            contract_id.clone(),
            vec![
                &env,
                symbol_short!("crl").into_val(&env),
                symbol_short!("revoked").into_val(&env),
                cert_id.clone().into_val(&env),
            ],
            expected_payload,
        ),
    ];

    assert_eq!(emitted, expected);
}

/// One revocation, one event: a second revocation must not reuse the first
/// event's certificate id, and the CRL head in each event must match the state
/// the contract actually holds afterwards.
#[test]
fn test_each_revocation_emits_its_own_event_with_the_current_crl_head() {
    use soroban_sdk::{symbol_short, vec, IntoVal};

    let (env, issuer, cert_contract) = setup();
    let (contract_id, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let first = String::from_str(&env, "CERT-001");
    client.revoke_certificate(&issuer, &first, &RevocationReason::KeyCompromise, &None);
    let after_first = client.get_crl_info();

    let second = String::from_str(&env, "CERT-002");
    client.revoke_certificate(&issuer, &second, &RevocationReason::CACompromise, &None);
    // Captured before the reads below, which are themselves contract calls.
    let emitted = env.events().all();
    let after_second = client.get_crl_info();

    // crl_number and revoked_count advance after every revocation, so the two
    // events differ even though only the certificate id changed in the call.
    assert_eq!(after_second.revoked_count, 2);
    assert_eq!(after_second.crl_number, after_first.crl_number + 1);
    assert_ne!(after_first.merkle_root, after_second.merkle_root);

    let expected_payload = legacy_payload(
        &env,
        &[
            ("certificate_id", second.clone().into_val(&env)),
            ("reason", (RevocationReason::CACompromise as u32).into_val(&env)),
            ("revoked_by", issuer.clone().into_val(&env)),
            ("revocation_date", env.ledger().timestamp().into_val(&env)),
            ("revoked_count", after_second.revoked_count.into_val(&env)),
            ("crl_number", after_second.crl_number.into_val(&env)),
            ("merkle_root", after_second.merkle_root.clone().into_val(&env)),
            ("this_update", after_second.this_update.into_val(&env)),
            ("next_update", after_second.next_update.into_val(&env)),
        ],
    );

    let expected = vec![
        &env,
        (
            contract_id.clone(),
            vec![
                &env,
                symbol_short!("crl").into_val(&env),
                symbol_short!("revoked").into_val(&env),
                second.clone().into_val(&env),
            ],
            expected_payload,
        ),
    ];

    assert_eq!(emitted, expected);
    assert_eq!(client.get_revoked_count(), 2);
}

/// A rejected revocation must not signal anything: an indexer that reacted to a
/// failed call would mark a certificate as revoked that the contract never
/// revoked.
#[test]
fn test_rejected_revocation_emits_no_event() {
    let (env, issuer, cert_contract) = setup();
    let (_, client) = make_client(&env);
    client.initialize(&issuer, &cert_contract);

    let cert_id = String::from_str(&env, "CERT-001");
    client.revoke_certificate(&issuer, &cert_id, &RevocationReason::KeyCompromise, &None);

    let duplicate = client.try_revoke_certificate(
        &issuer,
        &cert_id,
        &RevocationReason::KeyCompromise,
        &None,
    );
    assert!(duplicate.is_err());
    assert!(env.events().all().events().is_empty());

    // And a revocation from an address that is neither issuer nor admin is
    // rejected the same way.
    let stranger = Address::generate(&env);
    let unauthorized = client.try_revoke_certificate(
        &stranger,
        &String::from_str(&env, "CERT-002"),
        &RevocationReason::KeyCompromise,
        &None,
    );
    assert!(unauthorized.is_err());
    assert!(env.events().all().events().is_empty());
}
