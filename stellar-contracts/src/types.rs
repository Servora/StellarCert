use soroban_sdk::{contracttype, Address, BytesN, String, Vec};

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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractVersion {
    pub version: u32,
    pub last_wasm_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateIssuedEvent {
    pub id: String,
    pub issuer: Address,
    pub owner: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateRevokedEvent {
    pub id: String,
    pub reason: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateSuspendedEvent {
    pub id: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateReinstatedEvent {
    pub id: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateFrozenEvent {
    pub id: String,
    pub reason: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CertificateUnfrozenEvent {
    pub id: String,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferAcceptedEvent {
    pub transfer_id: String,
    pub to_owner: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferCompletedEvent {
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
