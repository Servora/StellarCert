#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Env, String,
};

/// Number of contract events emitted by the most recent invocation.
///
/// soroban-sdk 27 returns `ContractEvents`, which is neither an iterator nor
/// indexable, so the old `events.last().unwrap().1` pattern no longer
/// compiles. `.all()` reports the events of the last invocation rather than a
/// running log, so each transition is checked immediately after it runs.
fn event_count(env: &Env) -> usize {
    env.events().all().events().len()
}

#[test]
fn test_status_transition_events() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let cert_id = String::from_str(&env, "test-cert");
    let metadata_uri = String::from_str(&env, "ipfs://test");

    env.mock_all_auths();
    client.initialize(&admin);
    client.add_issuer(&issuer);

    client.issue_certificate(&cert_id, &issuer, &owner, &metadata_uri, &None);

    // Suspend
    client.suspend_certificate(&cert_id, &String::from_str(&env, "suspended for testing"));
    assert!(event_count(&env) >= 1, "suspend should emit an event");
    assert_eq!(
        client.get_certificate(&cert_id).unwrap().status,
        CertificateStatus::Suspended
    );

    // Reinstate
    client.reinstate_certificate(&cert_id, &String::from_str(&env, "reinstated for testing"));
    assert!(event_count(&env) >= 1, "reinstate should emit an event");
    assert_eq!(
        client.get_certificate(&cert_id).unwrap().status,
        CertificateStatus::Active
    );

    // Freeze
    client.freeze_certificate(&cert_id, &String::from_str(&env, "frozen for testing"));
    assert!(event_count(&env) >= 1, "freeze should emit an event");
    assert_eq!(
        client.get_certificate(&cert_id).unwrap().status,
        CertificateStatus::Frozen
    );

    // Unfreeze
    client.unfreeze_certificate(&cert_id);
    assert!(event_count(&env) >= 1, "unfreeze should emit an event");
    assert_eq!(
        client.get_certificate(&cert_id).unwrap().status,
        CertificateStatus::Active
    );
}
