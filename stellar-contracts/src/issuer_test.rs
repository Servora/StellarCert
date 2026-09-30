#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{storage::Persistent, Address as _},
    Address, Env, String,
};

#[test]
fn test_issuer_management() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer1 = Address::generate(&env);
    let issuer2 = Address::generate(&env);

    // Initialize with admin
    env.mock_all_auths();
    client.initialize(&admin);

    // Initial count should be 0
    assert_eq!(client.get_issuer_count(), 0);
    assert_eq!(client.get_issuers().len(), 0);

    // Add first issuer
    env.mock_all_auths();
    client.add_issuer(&issuer1);

    assert_eq!(client.get_issuer_count(), 1);
    assert!(client.is_issuer(&issuer1));
    assert!(!client.is_issuer(&issuer2));

    let issuers = client.get_issuers();
    assert_eq!(issuers.len(), 1);
    assert_eq!(issuers.get(0).unwrap(), issuer1);

    // Add second issuer
    client.add_issuer(&issuer2);

    assert_eq!(client.get_issuer_count(), 2);
    assert!(client.is_issuer(&issuer2));

    let issuers = client.get_issuers();
    assert_eq!(issuers.len(), 2);

    // Add issuer1 again (should not increment count or add to list)
    client.add_issuer(&issuer1);
    assert_eq!(client.get_issuer_count(), 2);
    assert_eq!(client.get_issuers().len(), 2);
}

#[test]
fn test_issued_certificate_ttl_is_extended() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let id = String::from_str(&env, "cert-ttl-001");
    let metadata_uri = String::from_str(&env, "ipfs://ttl");

    env.mock_all_auths();
    client.initialize(&admin);
    env.mock_all_auths();
    client.add_issuer(&issuer);
    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);

    let ttl = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get_ttl(&DataKey::Certificate(id.clone()))
    });
    let expected_ttl = env.as_contract(&contract_id, || {
        crate::persistent::DEFAULT_TTL.min(env.storage().max_ttl())
    });

    assert_eq!(ttl, expected_ttl);
}

#[test]
fn test_remove_issuer_updates_vec_and_count() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer1 = Address::generate(&env);
    let issuer2 = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);
    env.mock_all_auths();

    client.add_issuer(&issuer1);
    client.add_issuer(&issuer2);
    assert_eq!(client.get_issuer_count(), 2);

    // Remove issuer1 — count must drop and Vec must no longer contain it.
    client.remove_issuer(&issuer1);

    assert_eq!(client.get_issuer_count(), 1);
    assert!(!client.is_issuer(&issuer1));
    assert!(client.is_issuer(&issuer2));

    let issuers = client.get_issuers();
    assert_eq!(issuers.len(), 1);
    assert_eq!(issuers.get(0).unwrap(), issuer2);
}

#[test]
fn test_remove_issuer_idempotent_on_missing_issuer() {
    // Removing an address that was never added must not panic, and must not
    // corrupt the count or list.
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer1 = Address::generate(&env);
    let ghost = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);
    env.mock_all_auths();

    client.add_issuer(&issuer1);
    assert_eq!(client.get_issuer_count(), 1);

    // Removing a non-existent address must be a no-op.
    client.remove_issuer(&ghost);

    assert_eq!(client.get_issuer_count(), 1);
    assert_eq!(client.get_issuers().len(), 1);
    assert!(client.is_issuer(&issuer1));
}

#[test]
fn test_remove_all_issuers_reaches_zero() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer1 = Address::generate(&env);
    let issuer2 = Address::generate(&env);
    let issuer3 = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);
    env.mock_all_auths();

    client.add_issuer(&issuer1);
    client.add_issuer(&issuer2);
    client.add_issuer(&issuer3);
    assert_eq!(client.get_issuer_count(), 3);

    client.remove_issuer(&issuer2);
    client.remove_issuer(&issuer1);
    client.remove_issuer(&issuer3);

    assert_eq!(client.get_issuer_count(), 0);
    assert_eq!(client.get_issuers().len(), 0);
    assert!(!client.is_issuer(&issuer1));
    assert!(!client.is_issuer(&issuer2));
    assert!(!client.is_issuer(&issuer3));
}

#[test]
#[should_panic(expected = "Pagination limit exceeds maximum allowed")]
fn test_get_certificates_by_issuer_rejects_oversized_limit() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let issuer = Address::generate(&env);

    // A limit above the enforced cap must panic before any storage
    // is scanned, regardless of how many certificates exist.
    client.get_certificates_by_issuer(
        &issuer,
        &Pagination {
            page: 1,
            limit: u32::MAX,
        },
    );
}

#[test]
#[should_panic(expected = "Pagination limit exceeds maximum allowed")]
fn test_get_certificates_by_owner_rejects_oversized_limit() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);

    client.get_certificates_by_owner(
        &owner,
        &Pagination {
            page: 1,
            limit: 101,
        },
    );
}

#[test]
fn test_get_certificates_by_issuer_accepts_limit_at_max() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let issuer = Address::generate(&env);

    // Exactly at the cap should still succeed (empty result, no certs issued).
    let result = client.get_certificates_by_issuer(
        &issuer,
        &Pagination {
            page: 1,
            limit: 100,
        },
    );
    assert_eq!(result.total, 0);
    assert_eq!(result.data.len(), 0);
    assert!(!result.has_next);
}

#[test]
fn test_freeze_certificate_allows_authorized_issuer() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let id = String::from_str(&env, "cert-freeze-authorized");
    let metadata_uri = String::from_str(&env, "ipfs://freeze-authorized");

    env.mock_all_auths();
    client.initialize(&admin);
    client.add_issuer(&issuer);
    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);

    client.freeze_certificate(&id, &String::from_str(&env, "authorized freeze"));

    let cert = client.get_certificate(&id).unwrap();
    assert_eq!(cert.status, CertificateStatus::Frozen);
}

#[test]
#[should_panic(expected = "Address is not an authorized issuer")]
fn test_freeze_certificate_rejects_removed_issuer() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let id = String::from_str(&env, "cert-freeze-removed-issuer");
    let metadata_uri = String::from_str(&env, "ipfs://freeze-removed");

    env.mock_all_auths();
    client.initialize(&admin);
    client.add_issuer(&issuer);
    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);

    // The certificate stays valid, but the issuer loses authorization.
    client.remove_issuer(&issuer);

    // A removed issuer must not be able to freeze certificates it issued.
    client.freeze_certificate(&id, &String::from_str(&env, "stale issuer freeze"));
}

#[test]
#[should_panic(expected = "Address is not an authorized issuer")]
fn test_unfreeze_certificate_rejects_removed_issuer() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let id = String::from_str(&env, "cert-unfreeze-removed-issuer");
    let metadata_uri = String::from_str(&env, "ipfs://unfreeze-removed");

    env.mock_all_auths();
    client.initialize(&admin);
    client.add_issuer(&issuer);
    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);

    // Freeze while the issuer is still authorized.
    client.freeze_certificate(&id, &String::from_str(&env, "freeze while authorized"));

    // Once authorization is revoked the stale issuer can no longer unfreeze.
    client.remove_issuer(&issuer);
    client.unfreeze_certificate(&id);
}
