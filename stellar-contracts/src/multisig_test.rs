#![cfg(test)]
use super::multisig::*;
use crate::{
    CertificateContract, CertificateContractClient, OptionalRequestStatus, Pagination,
    RequestStatus,
};
use soroban_sdk::{testutils::Address as _, vec, Address, Env, String};

#[test]
fn test_init_multisig_config() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let config = client.get_multisig_config(&issuer);
    assert_eq!(config.threshold, 2);
    assert_eq!(config.max_signers, 5);
    assert_eq!(config.signers.len(), 2);
}

#[test]
fn test_propose_certificate() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-001");
    let metadata = String::from_str(&env, "certificate metadata");

    let request = client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    assert_eq!(request.id, request_id);
    assert_eq!(request.issuer, issuer);
    assert_eq!(request.recipient, recipient);
    assert_eq!(request.status, RequestStatus::Pending);
    assert_eq!(request.approvals.len(), 0);
    assert_eq!(request.rejections.len(), 0);
}

#[test]
fn test_approve_request_success() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-002");
    let metadata = String::from_str(&env, "certificate metadata");

    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    // First approval
    let result = client.approve_request(&request_id, &signer1);
    assert!(result.success);
    assert_eq!(
        result.final_status,
        OptionalRequestStatus::Some(RequestStatus::Pending)
    );

    // Second approval - should reach threshold and become approved
    let result = client.approve_request(&request_id, &signer2);
    assert!(result.success);
    assert_eq!(
        result.final_status,
        OptionalRequestStatus::Some(RequestStatus::Approved)
    );

    // Check the request status
    let request = client.get_pending_request(&request_id, &issuer);
    assert_eq!(request.status, RequestStatus::Approved);
    assert_eq!(request.approvals.len(), 2);
}

#[test]
fn test_reject_request() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);

    // Set up config with 3 signers, threshold 2
    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-003");
    let metadata = String::from_str(&env, "certificate metadata");

    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    // Reject by one signer
    let rejection_reason = String::from_str(&env, "Insufficient supporting documentation");
    let result = client.reject_request(&request_id, &signer1, &Some(rejection_reason.clone()));
    assert!(result.success);
    assert_eq!(
        result.final_status,
        OptionalRequestStatus::Some(RequestStatus::Pending)
    );
    let request = client.get_pending_request(&request_id, &issuer);
    assert_eq!(request.rejection_reason, Some(rejection_reason));

    // Approve by another signer
    let result = client.approve_request(&request_id, &signer2);
    assert!(result.success);
    assert_eq!(
        result.final_status,
        OptionalRequestStatus::Some(RequestStatus::Pending)
    );

    // Approve by third signer - should succeed despite rejection
    let result = client.approve_request(&request_id, &signer3);
    assert!(result.success);
    assert_eq!(
        result.final_status,
        OptionalRequestStatus::Some(RequestStatus::Approved)
    );

    // Check the request status
    let request = client.get_pending_request(&request_id, &issuer);
    assert_eq!(request.status, RequestStatus::Approved);
    assert_eq!(request.approvals.len(), 2);
    assert_eq!(request.rejections.len(), 1);
}

#[test]
fn test_reject_request_impossible_approval() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);

    // Set up config with 3 signers, threshold 3 (all must approve)
    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &3, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-004");
    let metadata = String::from_str(&env, "certificate metadata");

    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    // Reject by one signer - with a 3-of-3 config this already makes approval impossible
    let result = client.reject_request(&request_id, &signer1, &None);
    assert!(result.success);
    assert_eq!(
        result.final_status,
        OptionalRequestStatus::Some(RequestStatus::Rejected)
    );

    // Check the request status
    let request = client.get_pending_request(&request_id, &issuer);
    assert_eq!(request.status, RequestStatus::Rejected);
    assert_eq!(request.rejections.len(), 1);
    assert_eq!(request.approvals.len(), 0);
}

#[test]
fn test_issue_approved_certificate() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];

    env.mock_all_auths();
    client.initialize(&admin);
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-005");
    let metadata = String::from_str(&env, "certificate metadata");

    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    // Get both approvals
    client.approve_request(&request_id, &signer1);
    client.approve_request(&request_id, &signer2);

    // Configure the external certificate contract and register the issuer
    let certificate_contract_id = env.register(CertificateContract, ());
    let certificate_contract_address = certificate_contract_id.clone();
    let certificate_client = CertificateContractClient::new(&env, &certificate_contract_id);
    env.mock_all_auths();
    certificate_client.initialize(&admin);
    certificate_client.add_issuer(&issuer);
    client.set_certificate_contract(&certificate_contract_address);

    // Issue the certificate
    let success = client.issue_approved_certificate(&request_id);
    assert!(success);

    // Check the request status
    let request = client.get_pending_request(&request_id, &issuer);
    assert_eq!(request.status, RequestStatus::Issued);

    // Verify the certificate was minted in CertificateContract
    assert!(certificate_client.certificate_exists(&request_id));
}

#[test]
fn test_cancel_request() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let _proposer = Address::generate(&env); // Same as issuer in this case
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-006");
    let metadata = String::from_str(&env, "certificate metadata");

    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    // Cancel the request (proposer is the issuer in our implementation)
    let success = client.cancel_request(&request_id, &issuer);
    assert!(success);

    // Check the request status
    let request = client.get_pending_request(&request_id, &issuer);
    assert_eq!(request.status, RequestStatus::Cancelled);
}

#[test]
fn test_update_multisig_config() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let initial_signers = vec![&env, signer1.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &1, &initial_signers, &5, &admin);

    // Update the config
    let new_signers = vec![&env, signer1.clone(), signer2.clone()];
    client.update_multisig_config(&issuer, &Some(2), &Some(new_signers), &Some(10));

    let config = client.get_multisig_config(&issuer);
    assert_eq!(config.threshold, 2);
    assert_eq!(config.max_signers, 10);
    assert_eq!(config.signers.len(), 2);
}

#[test]
fn test_invalid_approve_by_non_signer() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let non_signer = Address::generate(&env); // This address is not in the signers list

    let signers = vec![&env, signer1.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &1, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-007");
    let metadata = String::from_str(&env, "certificate metadata");

    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    // Try to approve with non-signer - should fail
    let result = client.approve_request(&request_id, &non_signer);
    assert!(!result.success);
    assert_eq!(
        result.message,
        String::from_str(&env, "Approver is not an authorized signer")
    );
}

#[test]
fn test_double_approval() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-008");
    let metadata = String::from_str(&env, "certificate metadata");

    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    // First approval
    let result = client.approve_request(&request_id, &signer1);
    assert!(result.success);

    // Second approval by same signer - should fail
    let result = client.approve_request(&request_id, &signer1);
    assert!(!result.success);
    assert_eq!(
        result.message,
        String::from_str(&env, "Request already approved by this signer")
    );
}

#[test]
fn test_expired_request() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);

    let signers = vec![&env, signer1.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &1, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-009");
    let metadata = String::from_str(&env, "certificate metadata");

    // Create request with 1 day expiration
    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &1);

    // Manually advance time to expire the request (in a real test, we'd use ledger time)
    // This is a simplified test - in reality we'd check the expiration in the contract
    let _is_expired = client.is_expired(&request_id);
    // Note: This depends on the current ledger time vs expiration time
    // For this test, we're just checking the function exists
}

#[test]
fn test_get_pending_requests_for_issuer_returns_paginated_results() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    for id in ["req-issuer-1", "req-issuer-2", "req-issuer-3"] {
        client.propose_certificate(
            &String::from_str(&env, id),
            &issuer,
            &recipient,
            &String::from_str(&env, "certificate metadata"),
            &7,
        );
    }

    client.approve_request(&String::from_str(&env, "req-issuer-2"), &signer1);
    client.approve_request(&String::from_str(&env, "req-issuer-2"), &signer2);

    let first_page =
        client.get_pending_requests_for_issuer(&issuer, &Pagination { page: 1, limit: 1 });
    assert_eq!(first_page.total, 2);
    assert_eq!(first_page.data.len(), 1);
    assert!(first_page.has_next);

    let second_page =
        client.get_pending_requests_for_issuer(&issuer, &Pagination { page: 2, limit: 1 });
    assert_eq!(second_page.total, 2);
    assert_eq!(second_page.data.len(), 1);
    assert!(!second_page.has_next);
}

#[test]
fn test_get_pending_requests_for_signer_returns_only_pending_requests() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);

    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];

    env.mock_all_auths();
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    for id in ["req-signer-1", "req-signer-2", "req-signer-3"] {
        client.propose_certificate(
            &String::from_str(&env, id),
            &issuer,
            &recipient,
            &String::from_str(&env, "certificate metadata"),
            &7,
        );
    }

    client.reject_request(&String::from_str(&env, "req-signer-2"), &signer1, &None);
    client.reject_request(&String::from_str(&env, "req-signer-2"), &signer2, &None);

    let requests =
        client.get_pending_requests_for_signer(&signer3, &Pagination { page: 1, limit: 10 });

    assert_eq!(requests.total, 2);
    assert_eq!(requests.data.len(), 2);
    assert!(requests
        .data
        .iter()
        .all(|request| request.status == RequestStatus::Pending));
}

#[test]
fn test_initialize_stores_admin() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin);

    assert_eq!(client.get_admin(), admin);
}

#[test]
#[should_panic(expected = "Admin already initialized")]
fn test_initialize_rejects_second_call() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin);
    env.mock_all_auths();
    client.initialize(&Address::generate(&env));
}

#[test]
fn test_set_certificate_contract_success() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&admin);

    env.mock_all_auths();
    let first_certificate_contract = Address::generate(&env);
    client.set_certificate_contract(&first_certificate_contract);
    assert_eq!(
        client.get_certificate_contract(),
        first_certificate_contract
    );

    let second_certificate_contract = Address::generate(&env);
    client.set_certificate_contract(&second_certificate_contract);
    assert_eq!(
        client.get_certificate_contract(),
        second_certificate_contract
    );
}

#[test]
#[should_panic(expected = "Contract not initialized")]
fn test_set_certificate_contract_rejects_uninitialized() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    client.set_certificate_contract(&Address::generate(&env));
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_set_certificate_contract_rejects_missing_admin_auth() {
    let env = Env::default();
    let contract_id = env.register(MultisigCertificateContract, ());
    let client = MultisigCertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    // initialize() now requires the admin's auth, so mock it for that call
    // only...
    env.mock_all_auths();
    client.initialize(&admin);

    // ...then drop all auth again. A random caller must not be able to
    // authorize the stored admin and hijack the certificate contract pointer.
    env.set_auths(&[]);
    client.set_certificate_contract(&Address::generate(&env));
}

// ---------------------------------------------------------------------------
// CertificateContract::propose_certificate (#612 / #569)
//
// `issuer.require_auth()` must stay inside the body of
// `CertificateContract::propose_certificate`, before any other work. The #569
// fix once landed at `impl`-block level - outside the function body - which
// stopped the crate compiling (#612) and silently left proposals
// unauthenticated. The tests below fail if that guard is removed, dropped or
// moved back out of the function.
// ---------------------------------------------------------------------------

#[test]
fn test_certificate_contract_propose_certificate_records_pending_request() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signers = vec![&env, Address::generate(&env), Address::generate(&env)];

    env.mock_all_auths();
    client.initialize(&admin);
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-612");
    let metadata = String::from_str(&env, "certificate metadata");

    let request = client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);

    assert_eq!(request.id, request_id);
    assert_eq!(request.issuer, issuer);
    assert_eq!(request.recipient, recipient);
    assert_eq!(request.proposer, issuer);
    assert_eq!(request.metadata, metadata);
    assert_eq!(request.status, RequestStatus::Pending);
    assert_eq!(request.approvals.len(), 0);
    assert_eq!(request.rejections.len(), 0);

    // The issuer - and only the issuer - authorized the proposal.
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, issuer);

    // The proposal is persisted and reachable through the read path.
    let stored = client.get_pending_request(&request_id, &issuer);
    assert_eq!(stored.id, request_id);
    assert_eq!(stored.status, RequestStatus::Pending);
}

#[test]
#[should_panic(expected = "HostError: Error(Auth, InvalidAction)")]
fn test_certificate_contract_propose_certificate_requires_issuer_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    // Do NOT invoke mock_all_auths(): proposing on behalf of `issuer` must be
    // rejected by the contract itself. The guard runs before the multisig
    // config lookup, so the host reports an Auth error rather than
    // "Issuer does not have multisig configuration" - which is exactly what
    // happened when the guard was orphaned outside the function in #612.
    let issuer = Address::generate(&env);
    client.propose_certificate(
        &String::from_str(&env, "req-612-unauthorized"),
        &issuer,
        &Address::generate(&env),
        &String::from_str(&env, "certificate metadata"),
        &7,
    );
}

#[test]
#[should_panic(expected = "Issuer does not have multisig configuration")]
fn test_certificate_contract_propose_certificate_rejects_unconfigured_issuer() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);

    client.propose_certificate(
        &String::from_str(&env, "req-612-unconfigured"),
        &issuer,
        &Address::generate(&env),
        &String::from_str(&env, "certificate metadata"),
        &7,
    );
}

#[test]
#[should_panic(expected = "Request already exists")]
fn test_certificate_contract_propose_certificate_rejects_duplicate_request_id() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let signers = vec![&env, Address::generate(&env), Address::generate(&env)];

    env.mock_all_auths();
    client.initialize(&admin);
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    let request_id = String::from_str(&env, "req-612-duplicate");
    let metadata = String::from_str(&env, "certificate metadata");

    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);
    client.propose_certificate(&request_id, &issuer, &recipient, &metadata, &7);
}

// ── #1026: propose_certificate and get_pending_request access control ───────

/// Builds a multisig contract with one configured issuer and two signers.
fn setup_multisig(
    env: &Env,
) -> (
    MultisigCertificateContractClient<'_>,
    Address,
    Address,
    Address,
) {
    let contract_id = env.register_contract(None, MultisigCertificateContract);
    let client = MultisigCertificateContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let issuer = Address::generate(env);
    let signer1 = Address::generate(env);
    let signer2 = Address::generate(env);
    let signers = vec![env, signer1.clone(), signer2.clone()];

    env.mock_all_auths();
    client.initialize(&admin);
    client.init_multisig_config(&issuer, &2, &signers, &5, &admin);

    (client, issuer, signer1, admin)
}

#[test]
#[should_panic(expected = "Issuer is not authorized")]
fn test_propose_certificate_rejects_unknown_issuer() {
    let env = Env::default();
    let (client, _issuer, _signer, _admin) = setup_multisig(&env);

    // An address with no multisig configuration is not an issuer this
    // contract recognises, and must not be able to raise requests.
    let stranger = Address::generate(&env);
    client.propose_certificate(
        &String::from_str(&env, "req-unknown"),
        &stranger,
        &Address::generate(&env),
        &String::from_str(&env, "ipfs://meta"),
        &30u32,
    );
}

#[test]
#[should_panic]
fn test_propose_certificate_requires_issuer_auth() {
    // No mock_all_auths for the proposal itself: previously anyone could
    // raise requests in an issuer's name and spam every signer's request
    // list. propose_certificate now requires the issuer's signature.
    let env = Env::default();
    let (client, issuer, _signer, _admin) = setup_multisig(&env);

    env.set_auths(&[]);
    client.propose_certificate(
        &String::from_str(&env, "req-unauthorized"),
        &issuer,
        &Address::generate(&env),
        &String::from_str(&env, "ipfs://meta"),
        &30u32,
    );
}

#[test]
#[should_panic(expected = "Not authorized to view this request")]
fn test_get_pending_request_rejects_unrelated_caller() {
    let env = Env::default();
    let (client, issuer, _signer, _admin) = setup_multisig(&env);

    let request_id = String::from_str(&env, "req-private");
    client.propose_certificate(
        &request_id,
        &issuer,
        &Address::generate(&env),
        &String::from_str(&env, "ipfs://meta"),
        &30u32,
    );

    // Requests carry recipient addresses and metadata. Before this change the
    // reader was world-readable, so anyone could enumerate them.
    let stranger = Address::generate(&env);
    client.get_pending_request(&request_id, &stranger);
}

#[test]
fn test_get_pending_request_allows_issuer_signer_and_admin() {
    let env = Env::default();
    let (client, issuer, signer1, admin) = setup_multisig(&env);

    let request_id = String::from_str(&env, "req-visible");
    client.propose_certificate(
        &request_id,
        &issuer,
        &Address::generate(&env),
        &String::from_str(&env, "ipfs://meta"),
        &30u32,
    );

    // Each authorized role can read it.
    assert_eq!(
        client.get_pending_request(&request_id, &issuer).id,
        request_id
    );
    assert_eq!(
        client.get_pending_request(&request_id, &signer1).id,
        request_id
    );
    assert_eq!(
        client.get_pending_request(&request_id, &admin).id,
        request_id
    );
}
