use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec, symbol_short};

use crate::types::{Certificate, CertificateError, CertificateMetadata, CertificateStatus};

/// Storage keys for the contract
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Certificate(String),    // Certificate ID -> Certificate
    Issuer(Address),        // Issuer address -> authorized status
    Admin,                  // Admin address
    CertificateCount,       // Total number of certificates
}

/// Events emitted by the contract
#[contracttype]
#[derive(Clone, Debug)]
pub struct CertificateIssuedEvent {
    pub id: String,
    pub issuer: Address,
    pub recipient: Address,
    pub issued_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct CertificateRevokedEvent {
    pub id: String,
    pub revoked_by: Address,
    pub revoked_at: u64,
}

#[contract]
pub struct CertificateContract;

#[contractimpl]
impl CertificateContract {
    /// Initialize the contract with an admin
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        
        admin.require_auth();
        
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::CertificateCount, &0u64);
        
        // Admin is automatically an authorized issuer
        env.storage().instance().set(&DataKey::Issuer(admin.clone()), &true);
    }

    /// Add an authorized issuer (only admin can do this)
    pub fn add_issuer(env: Env, issuer: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        env.storage().instance().set(&DataKey::Issuer(issuer), &true);
    }

    /// Remove an authorized issuer (only admin can do this)
    pub fn remove_issuer(env: Env, issuer: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        
        env.storage().instance().remove(&DataKey::Issuer(issuer));
    }

    /// Check if an address is an authorized issuer
    pub fn validate_issuer(env: Env, issuer: Address) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Issuer(issuer))
            .unwrap_or(false)
    }

    /// Issue a new certificate
    pub fn issue_certificate(
        env: Env,
        id: String,
        issuer: Address,
        recipient: Address,
        metadata: CertificateMetadata,
    ) -> Result<Certificate, CertificateError> {
        // Require authorization from the issuer
        issuer.require_auth();

        // Validate issuer is authorized
        if !Self::validate_issuer(env.clone(), issuer.clone()) {
            return Err(CertificateError::Unauthorized);
        }

        // Check if certificate already exists
        let cert_key = DataKey::Certificate(id.clone());
        if env.storage().instance().has(&cert_key) {
            return Err(CertificateError::AlreadyExists);
        }

        // Validate metadata
        if metadata.title.len() == 0 || metadata.course_name.len() == 0 {
            return Err(CertificateError::InvalidData);
        }

        // Get current timestamp
        let issued_at = env.ledger().timestamp();

        // Create certificate
        let certificate = Certificate {
            id: id.clone(),
            issuer: issuer.clone(),
            recipient: recipient.clone(),
            metadata,
            issued_at,
            status: CertificateStatus::Active,
        };

        // Store certificate
        env.storage().instance().set(&cert_key, &certificate);

        // Increment certificate count
        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CertificateCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::CertificateCount, &(count + 1));

        // Emit event
        env.events().publish(
            (symbol_short!("cert_issue"),),
            CertificateIssuedEvent {
                id: id.clone(),
                issuer: issuer.clone(),
                recipient: recipient.clone(),
                issued_at,
            },
        );

        Ok(certificate)
    }

    /// Get a certificate by ID
    pub fn get_certificate(env: Env, id: String) -> Result<Certificate, CertificateError> {
        let cert_key = DataKey::Certificate(id);
        
        env.storage()
            .instance()
            .get::<DataKey, Certificate>(&cert_key)
            .ok_or(CertificateError::NotFound)
    }

    /// Revoke a certificate (only issuer or admin can revoke)
    pub fn revoke_certificate(
        env: Env,
        id: String,
        revoker: Address,
    ) -> Result<(), CertificateError> {
        revoker.require_auth();

        let cert_key = DataKey::Certificate(id.clone());
        let mut certificate: Certificate = env
            .storage()
            .instance()
            .get(&cert_key)
            .ok_or(CertificateError::NotFound)?;

        // Check if already revoked
        if certificate.status == CertificateStatus::Revoked {
            return Err(CertificateError::AlreadyRevoked);
        }

        // Check authorization (must be issuer or admin)
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if revoker != certificate.issuer && revoker != admin {
            return Err(CertificateError::Unauthorized);
        }

        // Update status
        certificate.status = CertificateStatus::Revoked;
        env.storage().instance().set(&cert_key, &certificate);

        // Emit event
        let revoked_at = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("cert_revok"),),
            CertificateRevokedEvent {
                id,
                revoked_by: revoker,
                revoked_at,
            },
        );

        Ok(())
    }

    /// Verify if a certificate is valid (exists and is active)
    pub fn verify_certificate(env: Env, id: String) -> bool {
        if let Ok(certificate) = Self::get_certificate(env, id) {
            certificate.status == CertificateStatus::Active
        } else {
            false
        }
    }

    /// Get total number of certificates issued
    pub fn get_certificate_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CertificateCount)
            .unwrap_or(0)
    }

    /// Get certificates by recipient (requires pagination in production)
    pub fn get_certificates_by_recipient(
        env: Env,
        recipient: Address,
    ) -> Vec<String> {
        // Note: This is a basic implementation
        // In production, you'd want to maintain an index for efficient querying
        let mut cert_ids = Vec::new(&env);
        
        // This is inefficient and should be improved with proper indexing
        // For now, returning empty vector - would need separate storage for recipient index
        cert_ids
    }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap()
    }
}

#[cfg(test)]
mod test;