#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{storage::Instance, Address as _},
    Address, Env, String, Vec,
};

#[test]
fn test_admin_multisig_flow() {
    let env = Env::default();
    let contract_id = env.register(AdminMultisigContract, ());
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin1.clone());
    signers.push_back(admin2.clone());
    signers.push_back(admin3.clone());

    env.mock_all_auths();

    // Initialize with 2-of-3 multisig and a 10-ledger proposal window.
    client.init_admin_multisig(&2, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-1");
    let action = AdminAction::UpdateConfig(2, signers.clone(), 10);

    let proposal = client.propose_action(&proposal_id, &admin1, &action);

    assert_eq!(proposal.status, AdminProposalStatus::Pending);
    assert_eq!(proposal.created_ledger, env.ledger().sequence());
    assert_eq!(proposal.expires_at_ledger, env.ledger().sequence() + 10);

    // Admin2 approves (now 1-of-2)
    let status1 = client.approve_action(&proposal_id, &admin2);
    assert_eq!(status1, AdminProposalStatus::Pending);

    // Admin3 approves (now 2-of-2), reaches threshold, autocompletes
    let status2 = client.approve_action(&proposal_id, &admin3);
    assert_eq!(status2, AdminProposalStatus::Executed);

    let stored_proposal = client.get_proposal(&proposal_id, &admin1);
    assert_eq!(stored_proposal.status, AdminProposalStatus::Executed);
}

#[test]
#[should_panic(expected = "Unsupported action type")]
fn test_other_action_panics_on_execution() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminMultisigContract);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin1.clone());
    signers.push_back(admin2.clone());
    signers.push_back(admin3.clone());

    env.mock_all_auths();

    client.init_admin_multisig(&2, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-other");
    let action = AdminAction::Other(String::from_str(&env, "custom_action"));

    client.propose_action(&proposal_id, &admin1, &action);
    client.approve_action(&proposal_id, &admin2);
    // Reaching threshold triggers execute_action, which must not silently
    // succeed for an unsupported action type.
    client.approve_action(&proposal_id, &admin3);
}

#[test]
fn test_admin_multisig_instance_ttl_is_extended() {
    let env = Env::default();
    let contract_id = env.register(AdminMultisigContract, ());
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin1, admin2]);

    env.mock_all_auths();
    client.init_admin_multisig(&2, &signers, &10);

    let ttl = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let expected_ttl = env.as_contract(&contract_id, || {
        crate::persistent::DEFAULT_TTL.min(env.storage().max_ttl())
    });

    assert_eq!(ttl, expected_ttl);
}

#[test]
fn test_remove_issuer_action_executes_after_threshold() {
    let env = Env::default();
    let admin_multisig_contract_id = env.register(AdminMultisigContract, ());
    let client = AdminMultisigContractClient::new(&env, &admin_multisig_contract_id);
    let certificate_contract_id = env.register(CertificateContract, ());
    let certificate_client = CertificateContractClient::new(&env, &certificate_contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(admin1.clone());
    signers.push_back(admin2.clone());
    signers.push_back(admin3.clone());

    env.mock_all_auths();

    certificate_client.initialize(&admin_multisig_contract_id);
    certificate_client.add_issuer(&issuer);

    client.init_admin_multisig(&2, &signers, &5);
    client.set_admin_certificate_contract(&admin1, &certificate_contract_id);

    let proposal_id = String::from_str(&env, "remove-issuer-1");
    let action = AdminAction::RemoveIssuer(issuer.clone());

    client.propose_action(&proposal_id, &admin1, &action);
    assert!(!client.is_issuer_removed(&issuer));

    client.approve_action(&proposal_id, &admin2);
    assert!(!client.is_issuer_removed(&issuer));

    let status = client.approve_action(&proposal_id, &admin3);
    assert_eq!(status, AdminProposalStatus::Executed);
    assert!(client.is_issuer_removed(&issuer));

    let issue_result = certificate_client.try_issue_certificate(
        &String::from_str(&env, "issuer-removed-cert"),
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://meta"),
        &None,
    );
    assert!(issue_result.is_err());
}

#[test]
#[should_panic(expected = "Proposer cannot approve their own action")]
fn test_proposer_cannot_approve() {
    let env = Env::default();
    let contract_id = env.register(AdminMultisigContract, ());
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(admin1.clone());
    signers.push_back(admin2.clone());

    env.mock_all_auths();
    client.init_admin_multisig(&2, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-fail");
    let action = AdminAction::Other(String::from_str(&env, "fail_action"));

    client.propose_action(&proposal_id, &admin1, &action);
    client.approve_action(&proposal_id, &admin1);
}

#[test]
fn test_cancel_proposal() {
    let env = Env::default();
    let contract_id = env.register(AdminMultisigContract, ());
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin1.clone()]);

    env.mock_all_auths();
    client.init_admin_multisig(&1, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-cancel");
    let action = AdminAction::Other(String::from_str(&env, "to_be_canceled"));

    client.propose_action(&proposal_id, &admin1, &action);
    let proposal = client.get_proposal(&proposal_id, &admin1);
    assert_eq!(proposal.status, AdminProposalStatus::Pending);

    client.cancel_proposal(&proposal_id, &admin1);
    let canceled_proposal = client.get_proposal(&proposal_id, &admin1);
    assert_eq!(canceled_proposal.status, AdminProposalStatus::Cancelled);
    // The whole point of the fix: a cancellation must never be reported as a
    // rejection, so audit logs and indexers can tell the two apart.
    assert_ne!(canceled_proposal.status, AdminProposalStatus::Rejected);
}

#[test]
fn test_proposal_payload_is_untouched_by_cancellation() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminMultisigContract);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin1.clone()]);
    env.mock_all_auths();
    client.init_admin_multisig(&1, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-cancel-payload");
    let action = AdminAction::Other(String::from_str(&env, "keep_payload"));

    let proposed = client.propose_action(&proposal_id, &admin1, &action);
    client.cancel_proposal(&proposal_id, &admin1);
    let canceled = client.get_proposal(&proposal_id, &admin1);

    // Cancelling records a new status and nothing else: the action, proposer,
    // window and (empty) approval set stay exactly as proposed.
    assert_eq!(canceled.id, proposed.id);
    assert_eq!(canceled.action, proposed.action);
    assert_eq!(canceled.proposer, proposed.proposer);
    assert_eq!(canceled.approvals.len(), 0);
    assert_eq!(canceled.created_ledger, proposed.created_ledger);
    assert_eq!(canceled.expires_at_ledger, proposed.expires_at_ledger);
}

#[test]
#[should_panic(expected = "Proposal is not pending")]
fn test_cancelled_proposal_cannot_be_approved() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminMultisigContract);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin1.clone(), admin2.clone()]);
    env.mock_all_auths();
    client.init_admin_multisig(&2, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-cancel-then-approve");
    let action = AdminAction::Other(String::from_str(&env, "cancel_then_approve"));

    client.propose_action(&proposal_id, &admin1, &action);
    client.cancel_proposal(&proposal_id, &admin1);

    // A cancelled proposal is terminal, exactly like the previously used
    // `Rejected` status: it cannot be revived by collecting approvals.
    client.approve_action(&proposal_id, &admin2);
}

#[test]
#[should_panic(expected = "Proposal is not pending")]
fn test_cancelled_proposal_cannot_be_cancelled_twice() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminMultisigContract);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin1.clone()]);
    env.mock_all_auths();
    client.init_admin_multisig(&1, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-double-cancel");
    let action = AdminAction::Other(String::from_str(&env, "double_cancel"));

    client.propose_action(&proposal_id, &admin1, &action);
    client.cancel_proposal(&proposal_id, &admin1);
    client.cancel_proposal(&proposal_id, &admin1);
}

#[test]
#[should_panic(expected = "Only proposer can cancel")]
fn test_only_proposer_can_cancel() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminMultisigContract);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin1.clone(), admin2.clone()]);
    env.mock_all_auths();
    client.init_admin_multisig(&2, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-cancel-by-other");
    let action = AdminAction::Other(String::from_str(&env, "cancel_by_other"));

    client.propose_action(&proposal_id, &admin1, &action);
    client.cancel_proposal(&proposal_id, &admin2);
}

#[test]
#[should_panic(expected = "Invalid admin multisig configuration")]
fn test_init_rejects_threshold_above_signer_count() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminMultisigContract);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin1, admin2, admin3]); // 3 signers

    env.mock_all_auths();
    client.init_admin_multisig(&5, &signers, &10); // threshold=5 > 3 signers → panic
}

#[test]
#[should_panic(expected = "Not an authorized admin signer")]
fn test_non_signer_cannot_read_proposal() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminMultisigContract);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let outsider = Address::generate(&env);
    let signers = Vec::from_array(&env, [admin1.clone(), admin2]);

    env.mock_all_auths();
    client.init_admin_multisig(&2, &signers, &10);

    let proposal_id = String::from_str(&env, "prop-private");
    let action = AdminAction::Other(String::from_str(&env, "sensitive_action"));
    client.propose_action(&proposal_id, &admin1, &action);

    // A non-signer must not be able to read the proposal details.
    client.get_proposal(&proposal_id, &outsider);
}
