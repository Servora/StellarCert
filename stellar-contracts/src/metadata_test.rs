#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

fn schema(
    env: &Env,
    creator: &Address,
    active: bool,
    allow_custom_fields: bool,
) -> MetadataSchemaRecord {
    let fields = Vec::from_array(
        env,
        [MetadataFieldRule {
            name: String::from_str(env, "title"),
            field_type: MetadataFieldType::String,
            required: true,
            min_length: 2,
            max_length: 5,
        }],
    );
    let required_fields = Vec::from_array(env, [String::from_str(env, "title")]);
    MetadataSchemaRecord {
        id: String::from_str(
            env,
            if active {
                "active-schema"
            } else {
                "inactive-schema"
            },
        ),
        name: String::from_str(env, "certificate"),
        version: MetadataSchemaVersion {
            major: 1,
            minor: 0,
            patch: 0,
        },
        fields,
        required_fields,
        allow_custom_fields,
        created_by: creator.clone(),
        created_at: 1,
        is_active: active,
        previous_version_id: None,
    }
}

fn entries(env: &Env, title: &str) -> Vec<MetadataEntry> {
    Vec::from_array(
        env,
        [MetadataEntry {
            key: String::from_str(env, "title"),
            value: String::from_str(env, title),
            value_type: MetadataFieldType::String,
        }],
    )
}

fn register(env: &Env, contract_id: &Address, record: MetadataSchemaRecord) {
    env.as_contract(contract_id, || register_schema(env, record).unwrap());
}

fn validate(
    env: &Env,
    contract_id: &Address,
    schema_id: &str,
    metadata: &Vec<MetadataEntry>,
) -> MetadataValidationResult {
    let schema_id = String::from_str(env, schema_id);
    let certificate_id = String::from_str(env, "validation-test");
    env.as_contract(contract_id, || {
        validate_metadata(env, &schema_id, metadata, &certificate_id)
    })
}

#[test]
fn validation_accepts_valid_metadata_and_rejects_each_constraint() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let creator = Address::generate(&env);
    register(&env, &contract_id, schema(&env, &creator, true, false));
    register(&env, &contract_id, schema(&env, &creator, false, false));

    assert!(validate(&env, &contract_id, "active-schema", &entries(&env, "Valid")).valid);

    let missing_schema = validate(&env, &contract_id, "missing-schema", &Vec::new(&env));
    assert_eq!(
        missing_schema.errors.get(0).unwrap().constraint,
        String::from_str(&env, "exists")
    );

    let inactive = validate(
        &env,
        &contract_id,
        "inactive-schema",
        &entries(&env, "Valid"),
    );
    assert_eq!(
        inactive.errors.get(0).unwrap().constraint,
        String::from_str(&env, "active")
    );

    let missing_required = validate(&env, &contract_id, "active-schema", &Vec::new(&env));
    assert_eq!(
        missing_required.errors.get(0).unwrap().constraint,
        String::from_str(&env, "required")
    );

    let mut wrong_type = entries(&env, "Valid");
    let mut wrong_type_entry = wrong_type.get(0).unwrap();
    wrong_type_entry.value_type = MetadataFieldType::Number;
    wrong_type.set(0, wrong_type_entry);
    let type_result = validate(&env, &contract_id, "active-schema", &wrong_type);
    assert_eq!(
        type_result.errors.get(0).unwrap().constraint,
        String::from_str(&env, "type")
    );

    let too_short = validate(&env, &contract_id, "active-schema", &entries(&env, "x"));
    assert_eq!(
        too_short.errors.get(0).unwrap().constraint,
        String::from_str(&env, "minLength")
    );

    let too_long = validate(
        &env,
        &contract_id,
        "active-schema",
        &entries(&env, "toolong"),
    );
    assert_eq!(
        too_long.errors.get(0).unwrap().constraint,
        String::from_str(&env, "maxLength")
    );

    let mut custom = entries(&env, "Valid");
    custom.push_back(MetadataEntry {
        key: String::from_str(&env, "extra"),
        value: String::from_str(&env, "value"),
        value_type: MetadataFieldType::String,
    });
    let custom_result = validate(&env, &contract_id, "active-schema", &custom);
    assert_eq!(
        custom_result.errors.get(0).unwrap().constraint,
        String::from_str(&env, "noCustomFields")
    );
}

#[test]
fn issue_with_metadata_validates_before_writing_and_stores_valid_entries() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&creator);
    client.add_issuer(&issuer);
    client.register_metadata_schema(&schema(&env, &creator, true, false));

    let id = String::from_str(&env, "metadata-issue");
    client.issue_certificate_with_metadata(
        &id,
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://valid"),
        &None,
        &String::from_str(&env, "active-schema"),
        &entries(&env, "Valid"),
    );
    assert_eq!(
        client.get_certificate_metadata(&id).unwrap().entries,
        entries(&env, "Valid")
    );

    let invalid_id = String::from_str(&env, "metadata-issue-invalid");
    let invalid_result = client.try_issue_certificate_with_metadata(
        &invalid_id,
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://invalid"),
        &None,
        &String::from_str(&env, "active-schema"),
        &entries(&env, "x"),
    );
    assert!(invalid_result.is_err());
    assert!(client.get_certificate(&invalid_id).is_none());
    assert!(client.get_certificate_metadata(&invalid_id).is_none());
}

#[test]
fn update_with_metadata_validates_before_mutation() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&creator);
    client.add_issuer(&issuer);
    register(&env, &contract_id, schema(&env, &creator, true, false));

    let id = String::from_str(&env, "metadata-update");
    client.issue_certificate(
        &id,
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://before"),
        &None,
    );
    let before = client.get_certificate(&id).unwrap();

    let invalid_result = client.try_update_metadata_with_schema(
        &id,
        &String::from_str(&env, "ipfs://invalid"),
        &String::from_str(&env, "active-schema"),
        &entries(&env, "x"),
    );
    assert!(invalid_result.is_err());
    let after_invalid = client.get_certificate(&id).unwrap();
    assert_eq!(after_invalid.metadata_uri, before.metadata_uri);
    assert_eq!(after_invalid.version, before.version);
    assert!(client.get_certificate_metadata(&id).is_none());

    client.update_metadata_with_schema(
        &id,
        &String::from_str(&env, "ipfs://after"),
        &String::from_str(&env, "active-schema"),
        &entries(&env, "Valid"),
    );
    assert_eq!(
        client.get_certificate(&id).unwrap().metadata_uri,
        String::from_str(&env, "ipfs://after")
    );
    assert_eq!(
        client.get_certificate_metadata(&id).unwrap().entries,
        entries(&env, "Valid")
    );
}

#[test]
fn reissue_with_metadata_validates_before_creating_child() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);
    let issuer = Address::generate(&env);
    let owner = Address::generate(&env);
    let creator = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&creator);
    client.add_issuer(&issuer);
    client.register_metadata_schema(&schema(&env, &creator, true, false));

    let old_id = String::from_str(&env, "metadata-reissue-source");
    client.issue_certificate(
        &old_id,
        &issuer,
        &owner,
        &String::from_str(&env, "ipfs://source"),
        &None,
    );

    let new_id = String::from_str(&env, "metadata-reissue-child");
    let invalid_result = client.try_reissue_with_metadata(
        &old_id,
        &new_id,
        &issuer,
        &None,
        &String::from_str(&env, "ipfs://invalid"),
        &None,
        &String::from_str(&env, "active-schema"),
        &entries(&env, "x"),
    );
    assert!(invalid_result.is_err());
    assert!(client.get_certificate(&new_id).is_none());

    client.reissue_with_metadata(
        &old_id,
        &new_id,
        &issuer,
        &None,
        &String::from_str(&env, "ipfs://valid"),
        &None,
        &String::from_str(&env, "active-schema"),
        &entries(&env, "Valid"),
    );
    assert_eq!(
        client.get_certificate_metadata(&new_id).unwrap().entries,
        entries(&env, "Valid")
    );
}
