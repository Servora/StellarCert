use soroban_sdk::{contractevent, contracttype, Address, BytesN, String, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CertificateStatus {
    Active,
    Revoked,
    Expired,
    Suspended,
    Frozen,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub build: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Certificate {
    pub id: String,
    pub issuer: Address,
    pub owner: Address,
    pub status: CertificateStatus,
    pub metadata_uri: String,
    pub issued_at: u64,
    pub expires_at: Option<u64>,
    pub version: CertificateVersion,
    pub revocation_reason: Option<String>,
    pub status_reason: Option<String>,
    pub parent_certificate_id: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Issuer(Address),
    IssuerCount,
    Issuers,
    Certificate(String),
    MultisigConfig(Address),
    IssuerAdmin(Address),
    PendingRequest(String),
    IssuerRequestIds(Address),
    CertificateContract,
    SignerRequestIds(Address),
    IssuerCertIds(Address),
    OwnerCertIds(Address),
    ContractVersion,
    Transfer(String),
    CertificateTransfers(String),
    PendingTransfers(Address),
    TransferCount,
    /// Address of the CRL contract that revocations must be mirrored into.
    CrlContract,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractVersion {
    pub version: u32,
    pub last_wasm_hash: BytesN<32>,
}

// --- Contract events ---
//
// These are declared with `#[contractevent]` rather than `#[contracttype]` so the
// topic list and payload shape are checked at compile time and emitted into the
// contract spec (readable by off-chain indexers).
//
// The migration is wire-compatible with the `env.events().publish(...)` calls it
// replaces: the `topics = [...]` prefixes and the data payloads are identical, so
// the on-chain event stream is byte-for-byte unchanged.
//
// One wrinkle: `#[contractevent]` places each field in *either* the topic list or
// the data payload, never both. The old calls published the identifier as a topic
// *and* inside the payload (because the payloads were `#[contracttype]` structs,
// which encode to a map containing every field). To reproduce that exactly, each
// event below carries a `topic_*` field for the topic list alongside the plain
// `id`/`transfer_id` field that keeps it in the data map. Both must be set to the
// same value; the regression tests in `events_test` assert the full wire form.

/// A new certificate was issued. Topics: `("issued", id)`. Data: `{id, issuer, owner}`.
#[contractevent(topics = ["issued"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateIssuedEvent {
    /// Copy of `id` published as the second topic.
    #[topic]
    pub topic_id: String,
    pub id: String,
    pub issuer: Address,
    pub owner: Address,
}

/// A certificate was reissued under a new ID. Topics: `("reissued", id)`.
/// Data: `{id, old_id, issuer, owner}`.
#[contractevent(topics = ["reissued"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateReissuedEvent {
    /// Copy of `id` published as the second topic.
    #[topic]
    pub topic_id: String,
    pub id: String,
    pub old_id: String,
    pub issuer: Address,
    pub owner: Address,
}

/// A certificate was revoked. Topics: `("revoked", id)`. Data: `{id, reason}`.
#[contractevent(topics = ["revoked"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateRevokedEvent {
    /// Copy of `id` published as the second topic.
    #[topic]
    pub topic_id: String,
    pub id: String,
    pub reason: String,
}

/// A certificate was suspended. Topics: `("suspend", id)`. Data: `{id}`.
#[contractevent(topics = ["suspend"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateSuspendedEvent {
    /// Copy of `id` published as the second topic.
    #[topic]
    pub topic_id: String,
    pub id: String,
}

/// A suspended certificate was reinstated. Topics: `("reinstat", id)`. Data: `{id}`.
#[contractevent(topics = ["reinstat"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateReinstatedEvent {
    /// Copy of `id` published as the second topic.
    #[topic]
    pub topic_id: String,
    pub id: String,
}

/// A certificate was frozen. Topics: `("frozen", id)`. Data: `{id, reason}`.
#[contractevent(topics = ["frozen"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateFrozenEvent {
    /// Copy of `id` published as the second topic.
    #[topic]
    pub topic_id: String,
    pub id: String,
    pub reason: String,
}

/// A frozen certificate was unfrozen. Topics: `("unfrozen", id)`. Data: `{id}`.
#[contractevent(topics = ["unfrozen"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateUnfrozenEvent {
    /// Copy of `id` published as the second topic.
    #[topic]
    pub topic_id: String,
    pub id: String,
}

/// The recipient accepted a pending transfer. Topics: `("accepted", transfer_id)`.
/// Data: `{transfer_id, to_owner}`.
#[contractevent(topics = ["accepted"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferAcceptedEvent {
    /// Copy of `transfer_id` published as the second topic.
    #[topic]
    pub topic_transfer_id: String,
    pub transfer_id: String,
    pub to_owner: Address,
}

/// A transfer reached its final state and ownership was updated.
/// Topics: `("transfer_done", transfer_id)`.
/// Data: `{transfer_id, certificate_id, from_owner, to_owner}`.
#[contractevent(topics = ["transfer_done"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferCompletedEvent {
    /// Copy of `transfer_id` published as the second topic.
    #[topic]
    pub topic_transfer_id: String,
    pub transfer_id: String,
    pub certificate_id: String,
    pub from_owner: Address,
    pub to_owner: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TransferStatus {
    Pending,
    Accepted,
    Rejected,
    Completed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateTransfer {
    pub id: String,
    pub certificate_id: String,
    pub from_owner: Address,
    pub to_owner: Address,
    pub status: TransferStatus,
    pub initiated_at: u64,
    pub accepted_at: Option<u64>,
    pub completed_at: Option<u64>,
    pub require_revocation: bool,
    pub transfer_fee: u64,
    pub memo: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferHistoryEntry {
    pub transfer_id: String,
    pub from_address: Address,
    pub to_address: Address,
    pub completed_at: u64,
    pub transfer_fee: u64,
    pub memo: Option<String>,
}

// Multisig Types
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigConfig {
    pub threshold: u32,
    pub signers: Vec<Address>,
    pub max_signers: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    Pending,
    Approved,
    Rejected,
    Cancelled,
    Expired,
    Issued,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OptionalRequestStatus {
    None,
    Some(RequestStatus),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingRequest {
    pub id: String,
    pub issuer: Address,
    pub recipient: Address,
    pub metadata: String,
    pub proposer: Address,
    pub approvals: Vec<Address>,
    pub rejections: Vec<Address>,
    pub rejection_reason: Option<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: RequestStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignatureResult {
    pub success: bool,
    pub message: String,
    pub final_status: OptionalRequestStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pagination {
    pub page: u32,
    pub limit: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaginatedResult {
    pub data: Vec<PendingRequest>,
    pub total: u32,
    pub page: u32,
    pub limit: u32,
    pub has_next: bool,
}

// Batch Verification Types
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationResult {
    pub id: String,
    pub exists: bool,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerificationReport {
    pub total: u32,
    pub successful: u32,
    pub failed: u32,
    pub total_cost: u64,
    pub results: Vec<VerificationResult>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertPaginatedResult {
    pub data: Vec<Certificate>,
    pub total: u32,
    pub page: u32,
    pub limit: u32,
    pub has_next: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferInitiatedEvent {
    pub transfer_id: u64,
    pub certificate_id: u64,
    pub from_owner: Address,
    pub to_owner: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateMetadataUpdatedEvent {
    pub certificate_id: u64,
    pub updated_by: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateExpirySetEvent {
    pub certificate_id: u64,
    pub expiry: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuerAddedEvent {
    pub issuer: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuerRemovedEvent {
    pub issuer: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CertificateEvent {
    TransferInitiated(TransferInitiatedEvent),
    MetadataUpdated(CertificateMetadataUpdatedEvent),
    ExpirySet(CertificateExpirySetEvent),
    IssuerAdded(IssuerAddedEvent),
    IssuerRemoved(IssuerRemovedEvent),
}
