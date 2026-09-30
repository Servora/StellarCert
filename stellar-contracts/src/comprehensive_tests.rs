#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn create_test_env() -> (Env, CertificateContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);
    (env, client)
}

fn setup_issuer(env: &Env, client: &CertificateContractClient) -> (Address, Address) {
    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    client.initialize(&admin);
    client.add_issuer(&issuer);
    (admin, issuer)
}

#[test]
fn test_issue_and_get_certificate() {
    let (env, client) = create_test_env();
    let (_admin, issuer) = setup_issuer(&env, &client);
    let owner = Address::generate(&env);

    let id = String::from_str(&env, "123");
    let metadata_uri = String::from_str(&env, "ipfs://meta");

    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);

    let cert = client.get_certificate(&id).unwrap();
    assert_eq!(cert.id, id);
    assert_eq!(cert.issuer, issuer);
    assert_eq!(cert.owner, owner);
    assert_eq!(cert.status, CertificateStatus::Active);
    assert_eq!(cert.metadata_uri, metadata_uri);
}

#[test]
fn test_revoke_certificate() {
    let (env, client) = create_test_env();
    let (_admin, issuer) = setup_issuer(&env, &client);
    let owner = Address::generate(&env);
    let id = String::from_str(&env, "123");

    client.issue_certificate(
        &id,
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://meta"),
        &None,
    );
    client.revoke_certificate(&id, &String::from_str(&env, "reason"));

    let cert = client.get_certificate(&id).unwrap();
    assert_eq!(cert.status, CertificateStatus::Revoked);
}

#[test]
fn test_suspend_and_reinstate_certificate() {
    let (env, client) = create_test_env();
    let (_admin, issuer) = setup_issuer(&env, &client);
    let owner = Address::generate(&env);
    let id = String::from_str(&env, "123");

    client.issue_certificate(
        &id,
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://meta"),
        &None,
    );

    client.suspend_certificate(&id, &String::from_str(&env, "suspended for testing"));
    let cert = client.get_certificate(&id).unwrap();
    assert_eq!(cert.status, CertificateStatus::Suspended);

    client.reinstate_certificate(&id, &String::from_str(&env, "reinstated for testing"));
    let cert = client.get_certificate(&id).unwrap();
    assert_eq!(cert.status, CertificateStatus::Active);
}

#[test]
fn test_freeze_and_unfreeze_certificate() {
    let (env, client) = create_test_env();
    let (_admin, issuer) = setup_issuer(&env, &client);
    let owner = Address::generate(&env);
    let id = String::from_str(&env, "123");

    client.issue_certificate(
        &id,
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://meta"),
        &None,
    );

    client.freeze_certificate(&id, &String::from_str(&env, "under investigation"));
    let cert = client.get_certificate(&id).unwrap();
    assert_eq!(cert.status, CertificateStatus::Frozen);

    client.unfreeze_certificate(&id);
    let cert = client.get_certificate(&id).unwrap();
    assert_eq!(cert.status, CertificateStatus::Active);
}

#[test]
fn test_is_valid() {
    let (env, client) = create_test_env();
    let (_admin, issuer) = setup_issuer(&env, &client);
    let owner = Address::generate(&env);
    let id = String::from_str(&env, "123");

    client.issue_certificate(
        &id,
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://meta"),
        &None,
    );
    assert!(client.is_valid(&id));

    client.revoke_certificate(&id, &String::from_str(&env, "reason"));
    assert!(!client.is_valid(&id));
}
