#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_remove_issuer_clears_issuer_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);

    let id = String::from_str(&env, "cert-remove-issuer");
    let metadata_uri = String::from_str(&env, "ipfs://meta");

    client.initialize(&admin);
    client.add_issuer(&issuer);

    client.remove_issuer(&issuer);

    let issue_result = client.try_issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);
    assert!(issue_result.is_err());
}

#[test]
fn test_remove_issuer_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);

    client.initialize(&admin);

    // Removing a non-existent issuer should be a no-op.
    client.remove_issuer(&issuer);

    client.add_issuer(&issuer);
    client.remove_issuer(&issuer);
    client.remove_issuer(&issuer);
}
