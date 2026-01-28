use soroban_sdk::{contracttype, Address, String, Vec};

/// Certificate status enum
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CertificateStatus {
    Active,
    Revoked,
    Expired,
}

/// Certificate metadata structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct CertificateMetadata {
    pub title: String,
    pub description: String,
    pub course_name: String,
    pub completion_date: u64,
    pub ipfs_hash: String, // For storing additional data off-chain
}

/// Main Certificate structure
#[contracttype]
#[derive(Clone, Debug)]
pub struct Certificate {
    pub id: String,
    pub issuer: Address,
    pub recipient: Address,
    pub metadata: CertificateMetadata,
    pub issued_at: u64,
    pub status: CertificateStatus,
}

/// Error types for the contract
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CertificateError {
    AlreadyExists,
    NotFound,
    Unauthorized,
    InvalidData,
    AlreadyRevoked,
}