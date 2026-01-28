use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_certificate_count(), 0);
    assert!(client.validate_issuer(&admin));
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);
    client.initialize(&admin); // Should panic
}

#[test]
fn test_add_and_remove_issuer() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);

    env.mock_all_auths();
    
    client.initialize(&admin);
    
    // Initially, issuer should not be authorized
    assert!(!client.validate_issuer(&issuer));

    // Add issuer
    client.add_issuer(&issuer);
    assert!(client.validate_issuer(&issuer));

    // Remove issuer
    client.remove_issuer(&issuer);
    assert!(!client.validate_issuer(&issuer));
}

#[test]
fn test_issue_certificate_success() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-001");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Blockchain Developer"),
        description: String::from_str(&env, "Completed blockchain development course"),
        course_name: String::from_str(&env, "Advanced Blockchain"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest123"),
    };

    let result = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    
    assert!(result.is_ok());
    let certificate = result.unwrap();
    
    assert_eq!(certificate.id, cert_id);
    assert_eq!(certificate.issuer, issuer);
    assert_eq!(certificate.recipient, recipient);
    assert_eq!(certificate.status, CertificateStatus::Active);
    assert_eq!(client.get_certificate_count(), 1);
}

#[test]
fn test_issue_certificate_unauthorized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unauthorized_issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);

    let cert_id = String::from_str(&env, "CERT-002");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test Certificate"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest456"),
    };

    let result = client.issue_certificate(
        &cert_id,
        &unauthorized_issuer,
        &recipient,
        &metadata,
    );
    
    assert_eq!(result, Err(Ok(CertificateError::Unauthorized)));
}

#[test]
fn test_issue_certificate_already_exists() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-003");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test Certificate"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest789"),
    };

    // Issue certificate first time
    let result1 = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    assert!(result1.is_ok());

    // Try to issue same certificate again
    let result2 = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    assert_eq!(result2, Err(Ok(CertificateError::AlreadyExists)));
}

#[test]
fn test_issue_certificate_invalid_data() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-004");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, ""),  // Empty title - invalid
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    let result = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    assert_eq!(result, Err(Ok(CertificateError::InvalidData)));
}

#[test]
fn test_get_certificate() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-005");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Data Science"),
        description: String::from_str(&env, "Completed data science course"),
        course_name: String::from_str(&env, "Data Science 101"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmDataScience"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    let result = client.get_certificate(&cert_id);
    assert!(result.is_ok());
    
    let certificate = result.unwrap();
    assert_eq!(certificate.id, cert_id);
    assert_eq!(certificate.issuer, issuer);
    assert_eq!(certificate.recipient, recipient);
}

#[test]
fn test_get_certificate_not_found() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin);

    let cert_id = String::from_str(&env, "CERT-999");
    let result = client.get_certificate(&cert_id);
    
    assert_eq!(result, Err(Ok(CertificateError::NotFound)));
}

#[test]
fn test_revoke_certificate_by_issuer() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-006");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Revoke by issuer
    let revoke_result = client.revoke_certificate(&cert_id, &issuer);
    assert!(revoke_result.is_ok());

    // Check certificate is revoked
    let certificate = client.get_certificate(&cert_id).unwrap();
    assert_eq!(certificate.status, CertificateStatus::Revoked);
    assert!(!client.verify_certificate(&cert_id));
}

#[test]
fn test_revoke_certificate_by_admin() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-007");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Revoke by admin
    let revoke_result = client.revoke_certificate(&cert_id, &admin);
    assert!(revoke_result.is_ok());

    let certificate = client.get_certificate(&cert_id).unwrap();
    assert_eq!(certificate.status, CertificateStatus::Revoked);
}

#[test]
fn test_revoke_certificate_unauthorized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-008");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Try to revoke with unauthorized address
    let revoke_result = client.revoke_certificate(&cert_id, &unauthorized);
    assert_eq!(revoke_result, Err(Ok(CertificateError::Unauthorized)));
}

#[test]
fn test_verify_certificate() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-009");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    // Certificate doesn't exist yet
    assert!(!client.verify_certificate(&cert_id));

    // Issue certificate
    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    assert!(client.verify_certificate(&cert_id));

    // Revoke certificate
    client.revoke_certificate(&cert_id, &issuer);
    assert!(!client.verify_certificate(&cert_id));
}

#[test]
fn test_multiple_certificates() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CertificateContract);
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin);
    client.add_issuer(&issuer);

    // Issue multiple certificates
    for i in 1..=5 {
        let cert_id = String::from_str(&env, &format!("CERT-{:03}", i));
        let recipient = Address::generate(&env);
        let metadata = CertificateMetadata {
            title: String::from_str(&env, &format!("Certificate {}", i)),
            description: String::from_str(&env, "Test"),
            course_name: String::from_str(&env, "Test Course"),
            completion_date: 1704067200,
            ipfs_hash: String::from_str(&env, &format!("QmTest{}", i)),
        };

        let result = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
        assert!(result.is_ok());
    }

    assert_eq!(client.get_certificate_count(), 5);
}