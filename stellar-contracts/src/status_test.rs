#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    Address, Env, IntoVal, String,
};

#[test]
fn test_status_transition_events() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let cert_id = String::from_str(&env, "test-cert");
    let metadata_uri = String::from_str(&env, "ipfs://test");

    env.mock_all_auths();
    client.initialize(&admin);
    client.add_issuer(&issuer);

    // Issue certificate
    client.issue_certificate(&cert_id, &issuer, &owner, &metadata_uri, &None);

    // Test suspend
    client.suspend_certificate(&cert_id, &String::from_str(&env, "suspended for testing"));
    let events = env.events().all();
    let last_event = events.last().unwrap();
    assert_eq!(last_event.0, contract_id);
    assert_eq!(
        last_event.1,
        (symbol_short!("suspend"), cert_id.clone()).into_val(&env)
    );

    // Test reinstate
    client.reinstate_certificate(&cert_id, &String::from_str(&env, "reinstated for testing"));
    let events = env.events().all();
    let last_event = events.last().unwrap();
    assert_eq!(
        last_event.1,
        (symbol_short!("reinstat"), cert_id.clone()).into_val(&env)
    );

    // Test freeze
    client.freeze_certificate(&cert_id);
    let events = env.events().all();
    let last_event = events.last().unwrap();
    assert_eq!(
        last_event.1,
        (symbol_short!("frozen"), cert_id.clone()).into_val(&env)
    );

    // Test unfreeze
    client.unfreeze_certificate(&cert_id);
    let events = env.events().all();
    let last_event = events.last().unwrap();
    assert_eq!(
        last_event.1,
        (symbol_short!("unfrozen"), cert_id.clone()).into_val(&env)
    );
}
