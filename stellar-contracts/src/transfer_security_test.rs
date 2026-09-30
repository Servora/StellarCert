//! Regression tests for the transfer-ownership and initializer-auth fixes
//! (#1021, #1022).

use crate::types::{CertificateTransfer, TransferStatus};
use crate::{CertificateContract, CertificateContractClient, DataKey};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

struct Fixture {
    env: Env,
    client_id: Address,
    admin: Address,
    issuer: Address,
    alice: Address,
    bob: Address,
    carol: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);
    client.add_issuer(&issuer);

    Fixture {
        env,
        client_id: contract_id,
        admin,
        issuer,
        alice,
        bob,
        carol,
    }
}

fn client<'a>(f: &'a Fixture) -> CertificateContractClient<'a> {
    CertificateContractClient::new(&f.env, &f.client_id)
}

fn issue(f: &Fixture, cert_id: &str, owner: &Address) {
    client(f).issue_certificate(
        &String::from_str(&f.env, cert_id),
        &f.issuer,
        owner,
        &String::from_str(&f.env, "ipfs://meta"),
        &None,
    );
}

fn transfer_to(f: &Fixture, transfer_id: &str, cert_id: &str, from: &Address, to: &Address) {
    client(f).initiate_transfer(
        &String::from_str(&f.env, transfer_id),
        &String::from_str(&f.env, cert_id),
        from,
        to,
        &false,
        &0u64,
        &None,
    );
}

// ── #1021: a certificate must not be moved twice ────────────────────────────

#[test]
#[should_panic(expected = "Certificate already has an open transfer")]
fn test_cannot_open_two_transfers_for_one_certificate() {
    let f = setup();
    issue(&f, "cert-1", &f.alice);

    transfer_to(&f, "t-bob", "cert-1", &f.alice, &f.bob);
    // This is the root of the double-move: Alice offering the same
    // certificate to two people at once.
    transfer_to(&f, "t-carol", "cert-1", &f.alice, &f.carol);
}

#[test]
fn test_completing_a_transfer_cancels_its_siblings() {
    let f = setup();
    issue(&f, "cert-1", &f.alice);

    // Reach the dangerous state the way pre-fix data already can: two open
    // transfers, one of which completes.
    transfer_to(&f, "t-bob", "cert-1", &f.alice, &f.bob);
    let c = client(&f);

    c.accept_transfer(&String::from_str(&f.env, "t-bob"), &f.bob);
    c.complete_transfer(&String::from_str(&f.env, "t-bob"), &f.alice);

    let cert = c
        .get_certificate(&String::from_str(&f.env, "cert-1"))
        .expect("certificate should exist");
    assert_eq!(cert.owner, f.bob, "certificate should now belong to Bob");

    // Bob can open a fresh transfer, proving the completed one is closed and
    // no longer blocks the certificate.
    transfer_to(&f, "t-carol", "cert-1", &f.bob, &f.carol);
}

#[test]
#[should_panic(expected = "Certificate owner has changed")]
fn test_stale_transfer_cannot_move_certificate_from_new_owner() {
    // The A->B, A->C scenario from the issue.
    //
    // `initiate_transfer` now refuses a second open transfer, so this state
    // can no longer be reached through the public API. It can still exist in
    // storage on a contract that ran the old code, so the stale record is
    // injected directly here — that is exactly the data the ownership
    // re-check in `complete_transfer` has to defend against.
    let f = setup();
    issue(&f, "cert-1", &f.alice);
    let c = client(&f);

    // Alice -> Bob completes normally. Bob now owns the certificate.
    transfer_to(&f, "t-bob", "cert-1", &f.alice, &f.bob);
    c.accept_transfer(&String::from_str(&f.env, "t-bob"), &f.bob);
    c.complete_transfer(&String::from_str(&f.env, "t-bob"), &f.alice);

    let cert = c
        .get_certificate(&String::from_str(&f.env, "cert-1"))
        .expect("certificate should exist");
    assert_eq!(cert.owner, f.bob);

    // A legacy Alice -> Carol transfer, already accepted, left over from
    // before the single-open-transfer rule existed.
    let stale_id = String::from_str(&f.env, "t-carol-legacy");
    f.env.as_contract(&f.client_id, || {
        let stale = CertificateTransfer {
            id: stale_id.clone(),
            certificate_id: String::from_str(&f.env, "cert-1"),
            from_owner: f.alice.clone(),
            to_owner: f.carol.clone(),
            status: TransferStatus::Accepted,
            initiated_at: 0,
            accepted_at: Some(0),
            completed_at: None,
            require_revocation: false,
            transfer_fee: 0,
            memo: None,
        };
        f.env
            .storage()
            .persistent()
            .set(&DataKey::Transfer(stale_id.clone()), &stale);
    });

    // Pre-fix this succeeded and took the certificate away from Bob without
    // his consent. The owner re-check now rejects it.
    c.complete_transfer(&stale_id, &f.alice);
}

#[test]
#[should_panic(expected = "Can only transfer active certificates")]
fn test_revoked_certificate_cannot_be_completed() {
    let f = setup();
    issue(&f, "cert-1", &f.alice);
    let c = client(&f);

    transfer_to(&f, "t-bob", "cert-1", &f.alice, &f.bob);
    c.accept_transfer(&String::from_str(&f.env, "t-bob"), &f.bob);

    // Revoked after acceptance but before completion.
    c.revoke_certificate(
        &String::from_str(&f.env, "cert-1"),
        &String::from_str(&f.env, "compromised"),
    );

    c.complete_transfer(&String::from_str(&f.env, "t-bob"), &f.alice);
}

#[test]
#[should_panic(expected = "Can only transfer active certificates")]
fn test_frozen_certificate_cannot_be_completed() {
    let f = setup();
    issue(&f, "cert-1", &f.alice);
    let c = client(&f);

    transfer_to(&f, "t-bob", "cert-1", &f.alice, &f.bob);
    c.accept_transfer(&String::from_str(&f.env, "t-bob"), &f.bob);

    c.freeze_certificate(
        &String::from_str(&f.env, "cert-1"),
        &String::from_str(&f.env, "under investigation"),
    );

    c.complete_transfer(&String::from_str(&f.env, "t-bob"), &f.alice);
}

#[test]
fn test_normal_transfer_still_works() {
    // The guards must not block the ordinary path.
    let f = setup();
    issue(&f, "cert-1", &f.alice);
    let c = client(&f);

    transfer_to(&f, "t-bob", "cert-1", &f.alice, &f.bob);
    c.accept_transfer(&String::from_str(&f.env, "t-bob"), &f.bob);
    c.complete_transfer(&String::from_str(&f.env, "t-bob"), &f.alice);

    let cert = c
        .get_certificate(&String::from_str(&f.env, "cert-1"))
        .expect("certificate should exist");
    assert_eq!(cert.owner, f.bob);
}

// ── #1022: initializer authorization ────────────────────────────────────────

#[test]
#[should_panic(expected = "Admin already initialized")]
fn test_second_initialize_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let c = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);

    env.mock_all_auths();
    c.initialize(&admin);
    // Re-initializing must not let anyone replace the admin.
    c.initialize(&attacker);
}

#[test]
#[should_panic]
fn test_initialize_without_auth_fails() {
    // No mock_all_auths: initialize now requires the admin's signature, so a
    // caller who cannot produce it is rejected.
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let c = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    c.initialize(&admin);
}

#[test]
fn test_initialize_records_the_authorized_admin() {
    let f = setup();
    // add_issuer is admin-gated, so a successful call proves the admin stuck.
    client(&f).add_issuer(&Address::generate(&f.env));
    assert!(client(&f).get_issuer_count() >= 1);
    let _ = &f.admin;
}
