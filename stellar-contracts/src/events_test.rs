//! Regression tests for the `#[contractevent]` migration of the 14 call sites that
//! previously used the deprecated `env.events().publish` API (issue #961).
//!
//! The migration had to be behaviour-preserving, so these tests pin the *on-chain*
//! result of every migrated call site: the topic list, the data payload, and how
//! many events each invocation emits.
//!
//! `legacy_payload` rebuilds the payload the old implementation produced. Those
//! payloads were `#[contracttype]` structs, which Soroban encodes as a
//! `ScVal::Map` keyed by the field-name symbols; `#[contractevent]`'s default
//! `data_format = "map"` renders the same shape. Comparing against a hand-built map
//! therefore proves the two encodings are identical on the wire.

extern crate std;

use super::admin_multisig::AdminMultisigContractClient;
use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events as _},
    xdr, Address, Env, IntoVal, Map, String, Symbol, TryFromVal, Val,
};

/// The topic list plus data payload of one emitted event.
type ExpectedEvent = (std::vec::Vec<Val>, Val);

/// Build the data payload the pre-`#[contractevent]` implementation emitted.
fn legacy_payload(env: &Env, fields: &[(&str, Val)]) -> Val {
    let mut payload = Map::new(env);
    for (key, value) in fields {
        payload.set(Symbol::new(env, key), *value);
    }
    payload.into_val(env)
}

/// Assert the most recent contract invocation by `contract_id` emitted exactly
/// `expected`, in order.
///
/// `Env::events().all()` reports only the events of the *last* invocation, so
/// callers assert straight after each call instead of once at the end of a test.
/// The length check additionally pins that an operation emits no surprise events.
fn assert_events(env: &Env, contract_id: &Address, expected: &[ExpectedEvent]) {
    let emitted = env.events().all().filter_by_contract(contract_id);
    let emitted = emitted.events();

    assert_eq!(
        emitted.len(),
        expected.len(),
        "{contract_id:?} emitted the wrong number of events"
    );

    for (index, (topics, data)) in expected.iter().enumerate() {
        let xdr::ContractEventBody::V0(body) = &emitted[index].body;

        let expected_topics: std::vec::Vec<xdr::ScVal> = topics
            .iter()
            .map(|topic| xdr::ScVal::try_from_val(env, topic).unwrap())
            .collect();
        assert_eq!(
            body.topics.as_vec(),
            expected_topics.as_slice(),
            "event {index} has the wrong topics"
        );

        let expected_data = xdr::ScVal::try_from_val(env, data).unwrap();
        assert_eq!(
            body.data, expected_data,
            "event {index} has the wrong data payload"
        );
    }
}

/// Register `CertificateContract`, initialize it, and authorize `issuer`.
/// Returns the contract id and the authorized issuer address.
fn setup_certificate_contract(env: &Env) -> (Address, Address) {
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let issuer = Address::generate(env);

    client.initialize(&admin);
    env.mock_all_auths();
    client.add_issuer(&issuer);

    (contract_id, issuer)
}

/// Register `AdminMultisigContract` with the given threshold over two signers.
fn setup_admin_multisig(env: &Env, threshold: u32) -> (Address, Address, Address) {
    let contract_id = env.register(AdminMultisigContract, ());
    let client = AdminMultisigContractClient::new(env, &contract_id);

    let admin1 = Address::generate(env);
    let admin2 = Address::generate(env);
    let signers = soroban_sdk::Vec::from_array(env, [admin1.clone(), admin2.clone()]);

    env.mock_all_auths();
    client.init_admin_multisig(&threshold, &signers, &10);

    (contract_id, admin1, admin2)
}

/// The `issued` event, which most certificate tests start from.
fn issued(env: &Env, id: &String, issuer: &Address, owner: &Address) -> ExpectedEvent {
    (
        std::vec![
            symbol_short!("issued").into_val(env),
            id.clone().into_val(env),
        ],
        legacy_payload(
            env,
            &[
                ("id", id.clone().into_val(env)),
                ("issuer", issuer.clone().into_val(env)),
                ("owner", owner.clone().into_val(env)),
            ],
        ),
    )
}

/// A certificate event whose payload is just `{id}`.
fn id_only_event(env: &Env, topic: Symbol, id: &String) -> ExpectedEvent {
    (
        std::vec![topic.into_val(env), id.clone().into_val(env)],
        legacy_payload(env, &[("id", id.clone().into_val(env))]),
    )
}

/// A certificate event whose payload is `{id, reason}`.
fn id_and_reason_event(env: &Env, topic: Symbol, id: &String, reason: &String) -> ExpectedEvent {
    (
        std::vec![topic.into_val(env), id.clone().into_val(env)],
        legacy_payload(
            env,
            &[
                ("id", id.clone().into_val(env)),
                ("reason", reason.clone().into_val(env)),
            ],
        ),
    )
}

/// A `proposal`/`<action>` event carrying `{proposal_id, ...}`.
fn proposal_event(env: &Env, action: Symbol, fields: &[(&str, Val)]) -> ExpectedEvent {
    (
        std::vec![
            symbol_short!("proposal").into_val(env),
            action.into_val(env),
        ],
        legacy_payload(env, fields),
    )
}

#[test]
fn issue_certificate_emits_issued_event() {
    let env = Env::default();
    let (contract_id, issuer) = setup_certificate_contract(&env);
    let client = CertificateContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let id = String::from_str(&env, "cert-1");
    let metadata_uri = String::from_str(&env, "ipfs://meta-1");

    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);

    assert_events(&env, &contract_id, &[issued(&env, &id, &issuer, &owner)]);
}

#[test]
fn revoke_certificate_emits_revoked_event() {
    let env = Env::default();
    let (contract_id, issuer) = setup_certificate_contract(&env);
    let client = CertificateContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let id = String::from_str(&env, "cert-revoke");
    let metadata_uri = String::from_str(&env, "ipfs://meta");
    let reason = String::from_str(&env, "key_compromise");

    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);
    client.revoke_certificate(&id, &reason);

    assert_events(
        &env,
        &contract_id,
        &[id_and_reason_event(
            &env,
            Symbol::new(&env, "revoked"),
            &id,
            &reason,
        )],
    );
}

#[test]
fn suspend_and_reinstate_emit_their_events() {
    let env = Env::default();
    let (contract_id, issuer) = setup_certificate_contract(&env);
    let client = CertificateContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let id = String::from_str(&env, "cert-suspend");
    let metadata_uri = String::from_str(&env, "ipfs://meta");
    let reason = String::from_str(&env, "under_review");

    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);
    client.suspend_certificate(&id, &reason);

    // Both operations take a reason, but the payloads only ever carried the id.
    assert_events(
        &env,
        &contract_id,
        &[id_only_event(&env, Symbol::new(&env, "suspend"), &id)],
    );

    client.reinstate_certificate(&id, &reason);

    assert_events(
        &env,
        &contract_id,
        &[id_only_event(&env, Symbol::new(&env, "reinstat"), &id)],
    );
}

#[test]
fn freeze_and_unfreeze_emit_their_events() {
    let env = Env::default();
    let (contract_id, issuer) = setup_certificate_contract(&env);
    let client = CertificateContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let id = String::from_str(&env, "cert-freeze");
    let metadata_uri = String::from_str(&env, "ipfs://meta");
    let reason = String::from_str(&env, "compliance_hold");

    client.issue_certificate(&id, &issuer, &owner, &metadata_uri, &None);
    client.freeze_certificate(&id, &reason);

    assert_events(
        &env,
        &contract_id,
        &[id_and_reason_event(
            &env,
            Symbol::new(&env, "frozen"),
            &id,
            &reason,
        )],
    );

    client.unfreeze_certificate(&id);

    assert_events(
        &env,
        &contract_id,
        &[id_only_event(&env, Symbol::new(&env, "unfrozen"), &id)],
    );
}

#[test]
fn reissue_certificate_emits_reissued_event_with_parent_link() {
    let env = Env::default();
    let (contract_id, issuer) = setup_certificate_contract(&env);
    let client = CertificateContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let old_id = String::from_str(&env, "cert-v1");
    let new_id = String::from_str(&env, "cert-v2");
    let metadata_uri = String::from_str(&env, "ipfs://meta");

    client.issue_certificate(&old_id, &issuer, &owner, &metadata_uri, &None);
    client.reissue_certificate(
        &old_id,
        &new_id,
        &issuer,
        &Some(new_owner.clone()),
        &metadata_uri,
        &None,
    );

    // A reissue only emits `reissued`; it does not revoke the parent certificate.
    assert_events(
        &env,
        &contract_id,
        &[(
            std::vec![
                symbol_short!("reissued").into_val(&env),
                new_id.clone().into_val(&env),
            ],
            legacy_payload(
                &env,
                &[
                    ("id", new_id.clone().into_val(&env)),
                    ("old_id", old_id.clone().into_val(&env)),
                    ("issuer", issuer.clone().into_val(&env)),
                    ("owner", new_owner.clone().into_val(&env)),
                ],
            ),
        )],
    );
}

#[test]
fn transfer_lifecycle_emits_accepted_and_transfer_done_events() {
    let env = Env::default();
    let (contract_id, issuer) = setup_certificate_contract(&env);
    let client = CertificateContractClient::new(&env, &contract_id);

    let from_owner = Address::generate(&env);
    let to_owner = Address::generate(&env);
    let cert_id = String::from_str(&env, "cert-transfer");
    let transfer_id = String::from_str(&env, "transfer-1");
    let metadata_uri = String::from_str(&env, "ipfs://meta");

    client.issue_certificate(&cert_id, &issuer, &from_owner, &metadata_uri, &None);
    client.initiate_transfer(
        &transfer_id,
        &cert_id,
        &from_owner,
        &to_owner,
        &false,
        &0,
        &None,
    );

    // Starting a transfer has never published anything.
    assert_events(&env, &contract_id, &[]);

    client.accept_transfer(&transfer_id, &to_owner);

    assert_events(
        &env,
        &contract_id,
        &[(
            std::vec![
                symbol_short!("accepted").into_val(&env),
                transfer_id.clone().into_val(&env),
            ],
            legacy_payload(
                &env,
                &[
                    ("transfer_id", transfer_id.clone().into_val(&env)),
                    ("to_owner", to_owner.clone().into_val(&env)),
                ],
            ),
        )],
    );

    client.complete_transfer(&transfer_id, &from_owner);

    assert_events(
        &env,
        &contract_id,
        &[(
            std::vec![
                Symbol::new(&env, "transfer_done").into_val(&env),
                transfer_id.clone().into_val(&env),
            ],
            legacy_payload(
                &env,
                &[
                    ("transfer_id", transfer_id.clone().into_val(&env)),
                    ("certificate_id", cert_id.clone().into_val(&env)),
                    ("from_owner", from_owner.clone().into_val(&env)),
                    ("to_owner", to_owner.clone().into_val(&env)),
                ],
            ),
        )],
    );
}

#[test]
fn complete_transfer_with_revocation_emits_revoked_before_transfer_done() {
    let env = Env::default();
    let (contract_id, issuer) = setup_certificate_contract(&env);
    let client = CertificateContractClient::new(&env, &contract_id);

    let from_owner = Address::generate(&env);
    let to_owner = Address::generate(&env);
    let cert_id = String::from_str(&env, "cert-transfer-revoked");
    let transfer_id = String::from_str(&env, "transfer-revoked");
    let metadata_uri = String::from_str(&env, "ipfs://meta");

    client.issue_certificate(&cert_id, &issuer, &from_owner, &metadata_uri, &None);
    client.initiate_transfer(
        &transfer_id,
        &cert_id,
        &from_owner,
        &to_owner,
        &true,
        &0,
        &None,
    );
    client.accept_transfer(&transfer_id, &to_owner);
    client.complete_transfer(&transfer_id, &from_owner);

    // A single `complete_transfer` invocation publishes two events, in this order.
    assert_events(
        &env,
        &contract_id,
        &[
            id_and_reason_event(
                &env,
                Symbol::new(&env, "revoked"),
                &cert_id,
                &String::from_str(&env, "Transferred to new owner"),
            ),
            (
                std::vec![
                    Symbol::new(&env, "transfer_done").into_val(&env),
                    transfer_id.clone().into_val(&env),
                ],
                legacy_payload(
                    &env,
                    &[
                        ("transfer_id", transfer_id.clone().into_val(&env)),
                        ("certificate_id", cert_id.clone().into_val(&env)),
                        ("from_owner", from_owner.clone().into_val(&env)),
                        ("to_owner", to_owner.clone().into_val(&env)),
                    ],
                ),
            ),
        ],
    );
}

#[test]
fn admin_propose_and_cancel_emit_proposal_events() {
    let env = Env::default();
    let (contract_id, admin1, _admin2) = setup_admin_multisig(&env, 2);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let created_id = String::from_str(&env, "prop-created");
    let canceled_id = String::from_str(&env, "prop-canceled");
    let action = AdminAction::Other(String::from_str(&env, "custom_action"));
    let expiry = env.ledger().sequence() + 10;

    client.propose_action(&created_id, &admin1, &action);

    assert_events(
        &env,
        &contract_id,
        &[proposal_event(
            &env,
            Symbol::new(&env, "created"),
            &[
                ("proposal_id", created_id.clone().into_val(&env)),
                ("proposer", admin1.clone().into_val(&env)),
                ("expires_at_ledger", expiry.into_val(&env)),
            ],
        )],
    );

    client.propose_action(&canceled_id, &admin1, &action);
    client.cancel_proposal(&canceled_id, &admin1);

    assert_events(
        &env,
        &contract_id,
        &[proposal_event(
            &env,
            Symbol::new(&env, "canceled"),
            &[
                ("proposal_id", canceled_id.clone().into_val(&env)),
                ("proposer", admin1.clone().into_val(&env)),
            ],
        )],
    );
}

#[test]
fn admin_approval_and_execution_emit_approved_then_executed_events() {
    let env = Env::default();
    // 1-of-2 so a single approval reaches the threshold and executes the proposal.
    let (contract_id, admin1, admin2) = setup_admin_multisig(&env, 1);
    let client = AdminMultisigContractClient::new(&env, &contract_id);

    let proposal_id = String::from_str(&env, "prop-exec");
    let action = AdminAction::Other(String::from_str(&env, "custom_action"));

    client.propose_action(&proposal_id, &admin1, &action);
    client.approve_action(&proposal_id, &admin2);

    assert_events(
        &env,
        &contract_id,
        &[
            proposal_event(
                &env,
                Symbol::new(&env, "approved"),
                &[
                    ("proposal_id", proposal_id.clone().into_val(&env)),
                    ("approver", admin2.clone().into_val(&env)),
                    ("approval_count", 1u32.into_val(&env)),
                    ("threshold", 1u32.into_val(&env)),
                ],
            ),
            // `executed` published a bare `proposal_id` string rather than a
            // struct, so its data is the raw string, not a map.
            (
                std::vec![
                    symbol_short!("proposal").into_val(&env),
                    symbol_short!("executed").into_val(&env),
                ],
                proposal_id.clone().into_val(&env),
            ),
        ],
    );
}

/// The XDR discriminant of `ScSpecEventDataFormat`, as encoded in the contract
/// spec. It is the last field of the `ScSpecEntry::EventV0` variant, so its
/// four big-endian bytes are the final four bytes of the entry.
#[derive(Clone, Copy, Debug, PartialEq)]
enum PayloadFormat {
    /// `ScSpecEventDataFormat::SingleValue` (0).
    SingleValue,
    /// `ScSpecEventDataFormat::Map` (2).
    Map,
}

impl PayloadFormat {
    fn discriminant(self) -> [u8; 4] {
        let value = match self {
            PayloadFormat::SingleValue => 0u32,
            PayloadFormat::Map => 2u32,
        };
        value.to_be_bytes()
    }
}

/// The description of one declared event, as recorded in the contract spec.
struct EventSpec {
    name: &'static str,
    spec: std::vec::Vec<u8>,
    prefix_topics: &'static [&'static str],
    data_format: PayloadFormat,
    /// Params published in the topic list, in declaration order.
    topic_params: &'static [&'static str],
    /// Params encoded into the data payload, in declaration order.
    data_params: &'static [&'static str],
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle.as_bytes())
}

/// Every migrated event is described in the contract spec, which is what makes the
/// schema introspectable by off-chain indexers.
///
/// The `topic_*` versus data split is asserted because the wire compatibility of
/// this migration depends on it: the id has to be in the topic list (as it was
/// when the calls used `env.events().publish`) *and* in the data payload (as it
/// was when the payloads were `#[contracttype]` structs).
#[test]
fn migrated_events_are_described_in_the_contract_spec() {
    macro_rules! event_spec {
        ($ty:ty, [$($prefix:literal),*], $format:ident, [$($topic:literal),*], [$($data:literal),*]) => {

            EventSpec {
                name: stringify!($ty),
                spec: <$ty>::spec_xdr().to_vec(),
                prefix_topics: &[$($prefix),*],
                data_format: PayloadFormat::$format,
                topic_params: &[$($topic),*],
                data_params: &[$($data),*],
            }
        };
    }

    let cases = std::vec![
        event_spec!(
            CertificateIssuedEvent,
            ["issued"],
            Map,
            ["topic_id"],
            ["id", "issuer", "owner"]
        ),
        event_spec!(
            CertificateReissuedEvent,
            ["reissued"],
            Map,
            ["topic_id"],
            ["id", "old_id", "issuer", "owner"]
        ),
        event_spec!(
            CertificateRevokedEvent,
            ["revoked"],
            Map,
            ["topic_id"],
            ["id", "reason"]
        ),
        event_spec!(
            CertificateSuspendedEvent,
            ["suspend"],
            Map,
            ["topic_id"],
            ["id"]
        ),
        event_spec!(
            CertificateReinstatedEvent,
            ["reinstat"],
            Map,
            ["topic_id"],
            ["id"]
        ),
        event_spec!(
            CertificateFrozenEvent,
            ["frozen"],
            Map,
            ["topic_id"],
            ["id", "reason"]
        ),
        event_spec!(
            CertificateUnfrozenEvent,
            ["unfrozen"],
            Map,
            ["topic_id"],
            ["id"]
        ),
        event_spec!(
            TransferAcceptedEvent,
            ["accepted"],
            Map,
            ["topic_transfer_id"],
            ["transfer_id", "to_owner"]
        ),
        event_spec!(
            TransferCompletedEvent,
            ["transfer_done"],
            Map,
            ["topic_transfer_id"],
            ["transfer_id", "certificate_id", "from_owner", "to_owner"]
        ),
        event_spec!(
            ProposalCreatedEvent,
            ["proposal", "created"],
            Map,
            [],
            ["proposal_id", "proposer", "expires_at_ledger"]
        ),
        event_spec!(
            ProposalApprovedEvent,
            ["proposal", "approved"],
            Map,
            [],
            ["proposal_id", "approver", "approval_count", "threshold"]
        ),
        event_spec!(
            ProposalCanceledEvent,
            ["proposal", "canceled"],
            Map,
            [],
            ["proposal_id", "proposer"]
        ),
        // The one payload that is not a map, preserved from the original call.
        event_spec!(
            ProposalExecutedEvent,
            ["proposal", "executed"],
            SingleValue,
            [],
            ["proposal_id"]
        ),
    ];

    assert_eq!(cases.len(), 13, "expected a spec entry per event type");

    for case in cases {
        let name = case.name;
        let spec = case.spec.as_slice();

        assert!(!spec.is_empty(), "{name} has an empty contract spec entry");
        assert!(contains(spec, name), "{name} spec does not name the event");

        let tail = spec.len() - 4;
        assert_eq!(
            &spec[tail..],
            case.data_format.discriminant(),
            "{name} spec has a wrong data format"
        );

        for topic in case.prefix_topics {
            assert!(
                contains(spec, topic),
                "{name} spec is missing the \"{topic}\" prefix topic"
            );
        }
        for param in case.topic_params {
            assert!(
                contains(spec, param),
                "{name} spec is missing the \"{param}\" topic param"
            );
        }
        for param in case.data_params {
            assert!(
                contains(spec, param),
                "{name} spec is missing the \"{param}\" data param"
            );
        }
    }
}
