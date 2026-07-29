#![no_std]
use soroban_sdk::{
    contract, contractimpl, symbol_short, Address, BytesN, Env, IntoVal, String, Val, Vec,
};

mod types;
pub use types::*;

// mod metadata;
// pub use metadata::*;

mod multisig;
pub use multisig::*;

mod crl;
pub use crl::*;

pub mod persistent;

pub mod storage;

mod admin_multisig;
pub use admin_multisig::*;

#[cfg(test)]
mod admin_multisig_test;
#[cfg(test)]
mod crl_test;
#[cfg(test)]
mod issuer_test;
#[cfg(test)]
mod multisig_test;
#[cfg(test)]
mod status_test;

#[contract]
pub struct CertificateContract;

#[contractimpl]
impl CertificateContract {
    fn set_persistent<K, V>(env: &Env, key: &K, value: &V)
    where
        K: IntoVal<Env, Val>,
        V: IntoVal<Env, Val>,
    {
        env.storage().persistent().set(key, value);
        persistent::extend_ttl(env, key, None);
    }

    /// Initialize the contract with an admin account
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Admin already initialized");
        }
        Self::set_persistent(&env, &DataKey::Admin, &admin);
    }

    pub fn add_issuer(env: Env, issuer: Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();

        let key = DataKey::Issuer(issuer.clone());
        if !env.storage().persistent().has(&key) {
            let count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::IssuerCount)
                .unwrap_or(0);
            Self::set_persistent(&env, &DataKey::IssuerCount, &(count + 1));

            let mut issuers: Vec<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::Issuers)
                .unwrap_or(Vec::new(&env));
            issuers.push_back(issuer.clone());
            Self::set_persistent(&env, &DataKey::Issuers, &issuers);
        }
        Self::set_persistent(&env, &key, &true);
    }

    /// Check if an address is an authorized issuer
    pub fn is_issuer(env: Env, address: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Issuer(address))
            .unwrap_or(false)
    }

    /// Get the total number of authorized issuers
    pub fn get_issuer_count(env: Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::IssuerCount)
            .unwrap_or(0)
    }

    /// Get the list of all authorized issuers
    pub fn get_issuers(env: Env) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&DataKey::Issuers)
            .unwrap_or(Vec::new(&env))
    }

    /// Remove an authorized issuer (only admin can call)
    pub fn remove_issuer(env: Env, issuer: Address) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();

        let key = DataKey::Issuer(issuer.clone());

        // Only update the Vec and counter when the issuer was actually present.
        if env.storage().persistent().has(&key) {
            // Decrement the count (saturating so it never wraps below zero).
            let count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::IssuerCount)
                .unwrap_or(0);
            Self::set_persistent(&env, &DataKey::IssuerCount, &count.saturating_sub(1));

            // Rebuild the Issuers vec without the removed address.
            let issuers: Vec<Address> = env
                .storage()
                .persistent()
                .get(&DataKey::Issuers)
                .unwrap_or(Vec::new(&env));
            let mut updated = Vec::new(&env);
            for addr in issuers.iter() {
                if addr != issuer {
                    updated.push_back(addr);
                }
            }
            Self::set_persistent(&env, &DataKey::Issuers, &updated);

            env.storage().persistent().remove(&key);
        }
    }

    /// Issue a new certificate
    #[allow(clippy::too_many_arguments)]
    pub fn issue_certificate(
        env: Env,
        id: String,
        issuer: Address,
        owner: Address,
        metadata_uri: String,
        expires_at: Option<u64>,
    ) {
        issuer.require_auth();

        // Authorization check
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Issuer(issuer.clone()))
            .unwrap_or(false)
        {
            panic!("Address is not an authorized issuer");
        }

        // Uniqueness check
        if env
            .storage()
            .persistent()
            .has(&DataKey::Certificate(id.clone()))
        {
            panic!("Certificate with this ID already exists");
        }

        let cert = Certificate {
            id: id.clone(),
            issuer: issuer.clone(),
            owner: owner.clone(),
            status: CertificateStatus::Active,
            metadata_uri,
            issued_at: env.ledger().timestamp(),
            expires_at,
            version: CertificateVersion {
                major: 1,
                minor: 0,
                patch: 0,
                build: None,
            },
            revocation_reason: None,
            status_reason: None,
            parent_certificate_id: None,
        };

        // Store the certificate
        Self::set_persistent(&env, &DataKey::Certificate(id.clone()), &cert);

        // Track cert ID by issuer and owner
        Self::append_cert_id(&env, DataKey::IssuerCertIds(issuer.clone()), id.clone());
        Self::append_cert_id(&env, DataKey::OwnerCertIds(owner.clone()), id.clone());

        // Emit and publish issuance event
        env.events().publish(
            (symbol_short!("issued"), id.clone()),
            CertificateIssuedEvent { id, issuer, owner },
        );
    }

    /// Revoke an existing certificate (only the original issuer can revoke)
    pub fn revoke_certificate(env: Env, id: String, reason: String) {
        let mut cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(id.clone()))
            .expect("Certificate not found");
        cert.issuer.require_auth();

        if cert.status == CertificateStatus::Revoked {
            panic!("Certificate is already revoked");
        }

        cert.status = CertificateStatus::Revoked;
        cert.revocation_reason = Some(reason.clone());
        Self::set_persistent(&env, &DataKey::Certificate(id.clone()), &cert);

        // Emit and publish revocation event
        env.events().publish(
            (symbol_short!("revoked"), id.clone()),
            CertificateRevokedEvent { id, reason },
        );
    }

    /// Check if a certificate exists
    pub fn certificate_exists(env: Env, id: String) -> bool {
        env.storage().persistent().has(&DataKey::Certificate(id))
    }

    /// Get certificate details
    pub fn get_certificate(env: Env, id: String) -> Option<Certificate> {
        env.storage().persistent().get(&DataKey::Certificate(id))
    }

    /// Suspend a certificate (temporarily disable with reason)
    pub fn suspend_certificate(env: Env, id: String, reason: String) {
        let mut cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(id.clone()))
            .expect("Certificate not found");
        cert.issuer.require_auth();

        if cert.status != CertificateStatus::Active {
            panic!("Can only suspend active certificates");
        }

        cert.status = CertificateStatus::Suspended;
        cert.status_reason = Some(reason);
        Self::set_persistent(&env, &DataKey::Certificate(id.clone()), &cert);

        // Emit and publish suspension event
        env.events().publish(
            (symbol_short!("suspend"), id.clone()),
            CertificateSuspendedEvent { id },
        );
    }

    /// Reinstate a suspended certificate
    pub fn reinstate_certificate(env: Env, id: String, _reason: String) {
        let mut cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(id.clone()))
            .expect("Certificate not found");
        cert.issuer.require_auth();

        if cert.status != CertificateStatus::Suspended {
            panic!("Certificate is not suspended");
        }

        cert.status = CertificateStatus::Active;
        Self::set_persistent(&env, &DataKey::Certificate(id.clone()), &cert);

        // Emit and publish reinstatement event
        env.events().publish(
            (symbol_short!("reinstat"), id.clone()),
            CertificateReinstatedEvent { id },
        );
    }

    /// Freeze a certificate
    pub fn freeze_certificate(env: Env, id: String, reason: String) {
        let mut cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(id.clone()))
            .expect("Certificate not found");
        cert.issuer.require_auth();

        if cert.status == CertificateStatus::Frozen {
            panic!("Certificate is already frozen");
        }

        cert.status = CertificateStatus::Frozen;
        cert.status_reason = Some(reason.clone());
        Self::set_persistent(&env, &DataKey::Certificate(id.clone()), &cert);

        // Emit and publish freeze event
        env.events().publish(
            (symbol_short!("frozen"), id.clone()),
            CertificateFrozenEvent { id, reason },
        );
    }

    /// Unfreeze a certificate
    pub fn unfreeze_certificate(env: Env, id: String) {
        let mut cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(id.clone()))
            .expect("Certificate not found");
        cert.issuer.require_auth();

        if cert.status != CertificateStatus::Frozen {
            panic!("Certificate is not frozen");
        }

        cert.status = CertificateStatus::Active;
        Self::set_persistent(&env, &DataKey::Certificate(id.clone()), &cert);

        // Emit and publish unfreeze event
        env.events().publish(
            (symbol_short!("unfrozen"), id.clone()),
            CertificateUnfrozenEvent { id },
        );
    }

    /// Verify if a certificate is valid (active and not expired)
    pub fn is_valid(env: Env, id: String) -> bool {
        if let Some(cert) = env
            .storage()
            .persistent()
            .get::<_, Certificate>(&DataKey::Certificate(id))
        {
            if cert.status != CertificateStatus::Active {
                return false;
            }
            if let Some(expires) = cert.expires_at {
                if env.ledger().timestamp() >= expires {
                    return false;
                }
            }
            true
        } else {
            false
        }
    }

    /// Update certificate metadata (requires issuer auth)
    pub fn update_certificate_metadata(env: Env, id: String, new_metadata_uri: String) {
        let mut cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(id.clone()))
            .expect("Certificate not found");
        cert.issuer.require_auth();

        if cert.status != CertificateStatus::Active {
            panic!("Can only update metadata for active certificates");
        }

        // Increment version
        cert.version.minor += 1;
        cert.metadata_uri = new_metadata_uri;

        Self::set_persistent(&env, &DataKey::Certificate(id), &cert);
    }

    /// Reissue a certificate with new version (creates child certificate)
    #[allow(clippy::too_many_arguments)]
    pub fn reissue_certificate(
        env: Env,
        old_id: String,
        new_id: String,
        issuer: Address,
        new_owner: Option<Address>,
        new_metadata_uri: String,
        new_expires_at: Option<u64>,
    ) {
        issuer.require_auth();

        // Verify issuer is authorized
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&DataKey::Issuer(issuer.clone()))
            .unwrap_or(false)
        {
            panic!("Address is not an authorized issuer");
        }

        // Get original certificate
        let original_cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(old_id.clone()))
            .expect("Original certificate not found");

        // Verify issuer matches
        if original_cert.issuer != issuer {
            panic!("Issuer does not match original certificate");
        }

        // Check new ID doesn't exist
        if env
            .storage()
            .persistent()
            .has(&DataKey::Certificate(new_id.clone()))
        {
            panic!("Certificate with new ID already exists");
        }

        // Create new certificate with incremented version
        let new_version = CertificateVersion {
            major: original_cert.version.major,
            minor: original_cert.version.minor + 1,
            patch: 0,
            build: None,
        };

        let new_cert = Certificate {
            id: new_id.clone(),
            issuer: issuer.clone(),
            owner: new_owner.unwrap_or(original_cert.owner),
            status: CertificateStatus::Active,
            metadata_uri: new_metadata_uri,
            issued_at: env.ledger().timestamp(),
            expires_at: new_expires_at,
            version: new_version,
            revocation_reason: None,
            status_reason: None,
            parent_certificate_id: Some(old_id.clone()),
        };

        // Store new certificate
        Self::set_persistent(&env, &DataKey::Certificate(new_id.clone()), &new_cert);

        // Emit issuance event
        env.events().publish(
            (symbol_short!("issued"), new_id.clone()),
            CertificateIssuedEvent {
                id: new_id,
                issuer,
                owner: new_cert.owner,
            },
        );
    }

    // --- Certificate Transfer Functions ---

    /// Initiate a certificate ownership transfer
    #[allow(clippy::too_many_arguments)]
    pub fn initiate_transfer(
        env: Env,
        transfer_id: String,
        certificate_id: String,
        from_owner: Address,
        to_owner: Address,
        require_revocation: bool,
        transfer_fee: u64,
        memo: Option<String>,
    ) {
        from_owner.require_auth();

        // Get certificate
        let cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(certificate_id.clone()))
            .expect("Certificate not found");

        // Verify caller is the current owner
        if cert.owner != from_owner {
            panic!("Only certificate owner can initiate transfer");
        }

        // Verify certificate is active
        if cert.status != CertificateStatus::Active {
            panic!("Can only transfer active certificates");
        }

        // Check if transfer already exists
        if env
            .storage()
            .persistent()
            .has(&DataKey::Transfer(transfer_id.clone()))
        {
            panic!("Transfer with this ID already exists");
        }

        // Create transfer record
        let transfer = CertificateTransfer {
            id: transfer_id.clone(),
            certificate_id: certificate_id.clone(),
            from_owner: from_owner.clone(),
            to_owner: to_owner.clone(),
            status: TransferStatus::Pending,
            initiated_at: env.ledger().timestamp(),
            accepted_at: None,
            completed_at: None,
            require_revocation,
            transfer_fee,
            memo,
        };

        // Store transfer
        Self::set_persistent(&env, &DataKey::Transfer(transfer_id.clone()), &transfer);

        // Add to certificate's transfer history
        let mut transfers = Self::get_transfer_history(&env, certificate_id.clone());
        transfers.push_back(transfer_id.clone());
        Self::set_persistent(
            &env,
            &DataKey::CertificateTransfers(certificate_id),
            &transfers,
        );

        // Add to pending transfers for new owner
        let mut pending = Self::get_pending_transfers(&env, to_owner.clone());
        pending.push_back(transfer_id.clone());
        Self::set_persistent(&env, &DataKey::PendingTransfers(to_owner), &pending);

        // Increment transfer count
        let count = Self::get_transfer_count(&env);
        Self::set_persistent(&env, &DataKey::TransferCount, &(count + 1));
    }

    /// Accept a pending certificate transfer
    pub fn accept_transfer(env: Env, transfer_id: String, to_owner: Address) {
        to_owner.require_auth();

        let mut transfer: CertificateTransfer = env
            .storage()
            .persistent()
            .get(&DataKey::Transfer(transfer_id.clone()))
            .expect("Transfer not found");

        // Verify caller is the intended recipient
        if transfer.to_owner != to_owner {
            panic!("Only intended recipient can accept transfer");
        }

        // Verify transfer is pending
        if transfer.status != TransferStatus::Pending {
            panic!("Transfer is not pending");
        }

        transfer.status = TransferStatus::Accepted;
        transfer.accepted_at = Some(env.ledger().timestamp());

        Self::set_persistent(&env, &DataKey::Transfer(transfer_id.clone()), &transfer);

        // Emit the transfer acceptance event
        env.events().publish(
            (symbol_short!("accepted"), transfer_id.clone()),
            TransferAcceptedEvent {
                transfer_id: transfer_id.clone(),
                to_owner: to_owner.clone(),
            },
        );

        // Remove from pending transfers
        let pending = Self::get_pending_transfers(&env, to_owner.clone());
        let mut updated_pending = Vec::<String>::new(&env);
        for tid in pending.iter() {
            if tid != transfer_id {
                updated_pending.push_back(tid);
            }
        }
        Self::set_persistent(&env, &DataKey::PendingTransfers(to_owner), &updated_pending);
    }

    /// Complete a certificate transfer (requires original owner auth)
    pub fn complete_transfer(env: Env, transfer_id: String, from_owner: Address) {
        from_owner.require_auth();

        let mut transfer: CertificateTransfer = env
            .storage()
            .persistent()
            .get(&DataKey::Transfer(transfer_id.clone()))
            .expect("Transfer not found");

        // Verify caller is the original owner
        if transfer.from_owner != from_owner {
            panic!("Only original owner can complete transfer");
        }

        // Verify transfer is accepted
        if transfer.status != TransferStatus::Accepted {
            panic!("Transfer must be accepted before completion");
        }

         let mut cert: Certificate = env
    .storage()
    .persistent()
    .get(&DataKey::Certificate(transfer.certificate_id.clone()))
    .expect("Certificate not found");

let previous_owner = cert.owner.clone();
let new_owner = transfer.to_owner.clone();

// Remove certificate from old owner's index
Self::remove_cert_id(
    &env,
    DataKey::OwnerCertIds(previous_owner),
    transfer.certificate_id.clone(),
);

// Add certificate to new owner's index
Self::append_cert_id(
    &env,
    DataKey::OwnerCertIds(new_owner.clone()),
    transfer.certificate_id.clone(),
);

// Update certificate ownership
cert.owner = new_owner;

        // Revoke if required
        if transfer.require_revocation {
            cert.status = CertificateStatus::Revoked;
            let reason = String::from_str(&env, "Transferred to new owner");
            cert.revocation_reason = Some(reason.clone());

            // Emit and publish revocation event for indexers
            env.events().publish(
                (symbol_short!("revoked"), transfer.certificate_id.clone()),
                CertificateRevokedEvent {
                    id: transfer.certificate_id.clone(),
                    reason,
                },
            );
        }

        Self::set_persistent(
            &env,
            &DataKey::Certificate(transfer.certificate_id.clone()),
            &cert,
        );

        // Update transfer status
        transfer.status = TransferStatus::Completed;
        transfer.completed_at = Some(env.ledger().timestamp());

        Self::set_persistent(&env, &DataKey::Transfer(transfer_id.clone()), &transfer);

        // Emit a completion event for off-chain systems
        env.events().publish(
            (symbol_short!("transfer_done"), transfer_id.clone()),
            TransferCompletedEvent {
                transfer_id,
                certificate_id: cert.id,
                from_owner: transfer.from_owner,
                to_owner: cert.owner,
            },
        );
    }

    /// Reject a pending certificate transfer
    pub fn reject_transfer(env: Env, transfer_id: String, to_owner: Address) {
        to_owner.require_auth();

        let mut transfer: CertificateTransfer = env
            .storage()
            .persistent()
            .get(&DataKey::Transfer(transfer_id.clone()))
            .expect("Transfer not found");

        if transfer.to_owner != to_owner {
            panic!("Only intended recipient can reject transfer");
        }

        if transfer.status != TransferStatus::Pending {
            panic!("Transfer is not pending");
        }

        transfer.status = TransferStatus::Rejected;

        Self::set_persistent(&env, &DataKey::Transfer(transfer_id.clone()), &transfer);

        // Remove from pending transfers
        let pending = Self::get_pending_transfers(&env, to_owner.clone());
        let mut updated_pending = Vec::<String>::new(&env);
        for tid in pending.iter() {
            if tid != transfer_id {
                updated_pending.push_back(tid);
            }
        }
        Self::set_persistent(&env, &DataKey::PendingTransfers(to_owner), &updated_pending);
    }

    /// Cancel a pending certificate transfer
    pub fn cancel_transfer(env: Env, transfer_id: String, from_owner: Address) {
        from_owner.require_auth();

        let mut transfer: CertificateTransfer = env
            .storage()
            .persistent()
            .get(&DataKey::Transfer(transfer_id.clone()))
            .expect("Transfer not found");

        if transfer.from_owner != from_owner {
            panic!("Only initiator can cancel transfer");
        }

        if transfer.status != TransferStatus::Pending {
            panic!("Transfer is not pending");
        }

        transfer.status = TransferStatus::Cancelled;

        Self::set_persistent(&env, &DataKey::Transfer(transfer_id.clone()), &transfer);

        // Remove from pending transfers
        let pending = Self::get_pending_transfers(&env, transfer.to_owner.clone());
        let mut updated_pending = Vec::<String>::new(&env);
        for tid in pending.iter() {
            if tid != transfer_id {
                updated_pending.push_back(tid);
            }
        }
        Self::set_persistent(
            &env,
            &DataKey::PendingTransfers(transfer.to_owner),
            &updated_pending,
        );
    }

    /// Get transfer history for a certificate
    fn get_transfer_history(env: &Env, certificate_id: String) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::CertificateTransfers(certificate_id))
            .unwrap_or(Vec::<String>::new(env))
    }

    /// Get pending transfers for an address
    fn get_pending_transfers(env: &Env, address: Address) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingTransfers(address))
            .unwrap_or(Vec::<String>::new(env))
    }

    /// Get total transfer count
    fn get_transfer_count(env: &Env) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::TransferCount)
            .unwrap_or(0)
    }

    /// Get transfer details
    pub fn get_transfer(env: Env, transfer_id: String) -> CertificateTransfer {
        env.storage()
            .persistent()
            .get(&DataKey::Transfer(transfer_id))
            .expect("Transfer not found")
    }

    /// Get transfer history for a certificate (public wrapper)
    pub fn get_transfer_history_public(env: Env, certificate_id: String) -> Vec<String> {
        Self::get_transfer_history(&env, certificate_id)
    }

    /// Get pending transfers for an address (public wrapper)
    pub fn get_pending_transfers_public(env: Env, address: Address) -> Vec<String> {
        Self::get_pending_transfers(&env, address)
    }

    /// Get total transfer count (public wrapper)
    pub fn get_transfer_count_public(env: Env) -> u32 {
        Self::get_transfer_count(&env)
    }

    // --- Multisig Functions ---

    pub fn init_multisig_config(
        env: Env,
        issuer: Address,
        threshold: u32,
        signers: Vec<Address>,
        max_signers: u32,
        admin: Address,
    ) {
        admin.require_auth();
        #[allow(clippy::unnecessary_cast)]
        if threshold == 0
            || signers.is_empty()
            || threshold > signers.len() as u32
            || max_signers < threshold
        {
            panic!("Invalid multisig parameters");
        }
        Self::set_persistent(
            &env,
            &DataKey::MultisigConfig(issuer.clone()),
            &MultisigConfig {
                threshold,
                signers,
                max_signers,
            },
        );
        Self::set_persistent(&env, &DataKey::IssuerAdmin(issuer), &admin);
    }

    pub fn update_multisig_config(
        env: Env,
        issuer: Address,
        new_threshold: Option<u32>,
        new_signers: Option<Vec<Address>>,
        new_max_signers: Option<u32>,
    ) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::IssuerAdmin(issuer.clone()))
            .expect("Issuer admin not found");
        admin.require_auth();

        let mut config: MultisigConfig = env
            .storage()
            .persistent()
            .get(&DataKey::MultisigConfig(issuer.clone()))
            .expect("Multisig config not found");

        if let Some(signers) = new_signers {
            config.signers = signers;
        }
        if let Some(threshold) = new_threshold {
            config.threshold = threshold;
        }
        if let Some(max_signers) = new_max_signers {
            config.max_signers = max_signers;
        }

        #[allow(clippy::unnecessary_cast)]
        if config.threshold == 0
            || config.signers.is_empty()
            || config.threshold > config.signers.len() as u32
            || config.max_signers < config.threshold
        {
            panic!("Invalid updated multisig parameters");
        }

        Self::set_persistent(&env, &DataKey::MultisigConfig(issuer), &config);
    }

    issuer.require_auth();
    pub fn propose_certificate(
        env: Env,
        request_id: String,
        issuer: Address,
        recipient: Address,
        metadata: String,
        expiration_days: u32,
    ) -> PendingRequest {
        let config: MultisigConfig = env
            .storage()
            .persistent()
            .get(&DataKey::MultisigConfig(issuer.clone()))
            .expect("Issuer does not have multisig configuration");
        if env
            .storage()
            .persistent()
            .has(&DataKey::PendingRequest(request_id.clone()))
        {
            panic!("Request already exists");
        }

        let request = PendingRequest {
            id: request_id.clone(),
            issuer: issuer.clone(),
            recipient: recipient.clone(),
            metadata: metadata.clone(),
            proposer: issuer.clone(),
            approvals: Vec::new(&env),
            rejections: Vec::new(&env),
            rejection_reason: None,
            created_at: env.ledger().timestamp(),
            expires_at: env.ledger().timestamp() + (expiration_days as u64 * 24 * 60 * 60),
            status: RequestStatus::Pending,
        };

        Self::set_persistent(&env, &DataKey::PendingRequest(request_id.clone()), &request);

        Self::append_request_id(&env, DataKey::IssuerRequestIds(issuer), request_id.clone());

        for signer in config.signers.iter() {
            Self::append_request_id(&env, DataKey::SignerRequestIds(signer), request_id.clone());
        }

        request
    }

    pub fn approve_request(env: Env, request_id: String, approver: Address) -> SignatureResult {
        approver.require_auth();
        let mut request: PendingRequest = env
            .storage()
            .persistent()
            .get(&DataKey::PendingRequest(request_id.clone()))
            .expect("Request not found");

        if env.ledger().timestamp() > request.expires_at {
            request.status = RequestStatus::Expired;
            Self::set_persistent(&env, &DataKey::PendingRequest(request_id), &request);
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Expired"),
                final_status: OptionalRequestStatus::Some(RequestStatus::Expired),
            };
        }

        if request.status != RequestStatus::Pending {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Not pending"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        let config: MultisigConfig = env
            .storage()
            .persistent()
            .get(&DataKey::MultisigConfig(request.issuer.clone()))
            .expect("Config not found");
        if !config.signers.contains(&approver) {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Approver is not an authorized signer"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        if request.approvals.contains(&approver) {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Request already approved by this signer"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        request.approvals.push_back(approver);

        if request.approvals.len() >= config.threshold {
            request.status = RequestStatus::Approved;
        }

        Self::set_persistent(&env, &DataKey::PendingRequest(request_id), &request);
        SignatureResult {
            success: true,
            message: String::from_str(&env, "Approved"),
            final_status: OptionalRequestStatus::Some(request.status),
        }
    }

    pub fn reject_request(
        env: Env,
        request_id: String,
        rejector: Address,
        reason: Option<String>,
    ) -> SignatureResult {
        rejector.require_auth();
        let mut request: PendingRequest = env
            .storage()
            .persistent()
            .get(&DataKey::PendingRequest(request_id.clone()))
            .expect("Request not found");

        if request.status != RequestStatus::Pending {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Not pending"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        let config: MultisigConfig = env
            .storage()
            .persistent()
            .get(&DataKey::MultisigConfig(request.issuer.clone()))
            .expect("Config not found");

        if !request.rejections.contains(&rejector) {
            request.rejections.push_back(rejector);
            if reason.is_some() {
                request.rejection_reason = reason;
            }
        }

        let remaining_eligible_approvers = config
            .signers
            .len()
            .saturating_sub(request.rejections.len());
        if remaining_eligible_approvers < config.threshold {
            request.status = RequestStatus::Rejected;
        }

        Self::set_persistent(&env, &DataKey::PendingRequest(request_id), &request);
        SignatureResult {
            success: true,
            message: String::from_str(&env, "Rejected"),
            final_status: OptionalRequestStatus::Some(request.status),
        }
    }

    pub fn issue_approved_certificate(env: Env, request_id: String) -> bool {
        let mut request: PendingRequest = env
            .storage()
            .persistent()
            .get(&DataKey::PendingRequest(request_id.clone()))
            .expect("Request not found");
        if request.status != RequestStatus::Approved {
            return false;
        }
        request.issuer.require_auth();

        // Issue the actual certificate
        Self::issue_certificate(
            env.clone(),
            request.id.clone(),
            request.issuer.clone(),
            request.recipient.clone(),
            request.metadata.clone(),
            Some(request.expires_at),
        );

        request.status = RequestStatus::Issued;
        Self::set_persistent(&env, &DataKey::PendingRequest(request_id), &request);
        true
    }

    pub fn get_multisig_config(env: Env, issuer: Address) -> MultisigConfig {
        // Only the issuer or the contract admin may read the multisig config
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        let caller_is_admin = issuer == admin;
        if !caller_is_admin {
            issuer.require_auth();
        }
        env.storage()
            .persistent()
            .get(&DataKey::MultisigConfig(issuer))
            .expect("Multisig.config not found")
    }

    pub fn get_pending_request(env: Env, request_id: String, caller: Address) -> PendingRequest {
        caller.require_auth();
        let request: PendingRequest = env
            .storage()
            .persistent()
            .get(&DataKey::PendingRequest(request_id))
            .expect("Request not found");
        // Only the issuer, proposer, or an authorized signer may read the request
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        let is_authorized = caller == request.issuer
            || caller == request.proposer
            || caller == admin
            || env
                .storage()
                .persistent()
                .get::<_, MultisigConfig>(&DataKey::MultisigConfig(request.issuer.clone()))
                .map(|c| c.signers.contains(&caller))
                .unwrap_or(false);
        if !is_authorized {
            panic!("Not authorized to view this request");
        }
        request
    }

    pub fn is_expired(env: Env, request_id: String) -> bool {
        let request: PendingRequest = env
            .storage()
            .persistent()
            .get(&DataKey::PendingRequest(request_id))
            .expect("Request not found");
        env.ledger().timestamp() > request.expires_at
    }

    pub fn get_pending_requests_for_issuer(
        env: Env,
        issuer: Address,
        pagination: Pagination,
    ) -> PaginatedResult {
        Self::paginate_requests(
            &env,
            Self::get_request_ids(&env, DataKey::IssuerRequestIds(issuer)),
            pagination,
        )
    }

    pub fn get_pending_requests_for_signer(
        env: Env,
        signer: Address,
        pagination: Pagination,
    ) -> PaginatedResult {
        Self::paginate_requests(
            &env,
            Self::get_request_ids(&env, DataKey::SignerRequestIds(signer)),
            pagination,
        )
    }

    pub fn cancel_request(env: Env, request_id: String, requester: Address) -> bool {
        requester.require_auth();
        let mut request: PendingRequest = env
            .storage()
            .persistent()
            .get(&DataKey::PendingRequest(request_id.clone()))
            .expect("Request not found");
        if request.proposer != requester {
            panic!("Only proposer can cancel");
        }
        request.status = RequestStatus::Cancelled;
        Self::set_persistent(&env, &DataKey::PendingRequest(request_id), &request);
        true
    }

    /// Upgrade the contract WASM. Only callable by the stored admin (i.e. AdminMultisigContract).
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();

        // Bump version counter and record the new wasm hash
        let mut ver: ContractVersion = env
            .storage()
            .persistent()
            .get(&DataKey::ContractVersion)
            .unwrap_or(ContractVersion {
                version: 0,
                last_wasm_hash: new_wasm_hash.clone(),
            });
        ver.version += 1;
        ver.last_wasm_hash = new_wasm_hash.clone();
        Self::set_persistent(&env, &DataKey::ContractVersion, &ver);

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Get the current contract version info
    pub fn get_version(env: Env) -> ContractVersion {
        env.storage()
            .persistent()
            .get(&DataKey::ContractVersion)
            .unwrap_or(ContractVersion {
                version: 0,
                last_wasm_hash: BytesN::from_array(&env, &[0u8; 32]),
            })
    }

    /// Batch verify multiple certificates
    pub fn batch_verify_certificates(env: Env, ids: Vec<String>) -> VerificationReport {
        const MAX_BATCH_SIZE: u32 = 100;
        if ids.len() > MAX_BATCH_SIZE {
            panic!("Exceeded max batch size");
        }
        const BASE_VERIFICATION_COST: u64 = 100;
        const COST_PER_CERTIFICATE: u64 = 50;

        let mut results = Vec::<VerificationResult>::new(&env);
        let mut successful: u32 = 0;
        let mut failed: u32 = 0;

        for id in ids.iter() {
            if let Some(cert) = env
                .storage()
                .persistent()
                .get::<_, Certificate>(&DataKey::Certificate(id.clone()))
            {
                let is_expired_by_time = cert
                    .expires_at
                    .map_or(false, |exp| env.ledger().timestamp() >= exp);

                let is_revoked = cert.status == CertificateStatus::Revoked
                    || cert.status == CertificateStatus::Suspended
                    || cert.status == CertificateStatus::Expired
                    || is_expired_by_time;

                if !is_revoked {
                    successful += 1;
                } else {
                    failed += 1;
                }

                results.push_back(VerificationResult {
                    id: id.clone(),
                    exists: true,
                    revoked: is_revoked,
                });
            } else {
                failed += 1;
                results.push_back(VerificationResult {
                    id: id.clone(),
                    exists: false,
                    revoked: false,
                });
            }
        }

        let total_cost = BASE_VERIFICATION_COST + (COST_PER_CERTIFICATE * ids.len() as u64);

        VerificationReport {
            total: ids.len(),
            successful,
            failed,
            total_cost,
            results,
        }
    }

    /// Set certificate expiry (only admin can call)
    pub fn set_certificate_expiry(env: Env, id: String, expiry_time: u64, admin: Address) {
        let stored_admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();

        if admin != stored_admin {
            panic!("Only admin can set certificate expiry");
        }

        let mut cert: Certificate = env
            .storage()
            .persistent()
            .get(&DataKey::Certificate(id.clone()))
            .expect("Certificate not found");

        cert.expires_at = Some(expiry_time);
        Self::set_persistent(&env, &DataKey::Certificate(id), &cert);
    }

    /// Get certificate expiry time
    pub fn get_certificate_expiry(env: Env, id: String) -> Option<u64> {
        if let Some(cert) = env
            .storage()
            .persistent()
            .get::<_, Certificate>(&DataKey::Certificate(id))
        {
            cert.expires_at
        } else {
            None
        }
    }

    /// Get all certificates issued by a given issuer (paginated)
    pub fn get_certificates_by_issuer(
        env: Env,
        issuer: Address,
        pagination: Pagination,
    ) -> CertPaginatedResult {
        let ids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::IssuerCertIds(issuer))
            .unwrap_or(Vec::<String>::new(&env));
        Self::paginate_certificates(&env, ids, pagination)
    }

    /// Get all certificates owned by a given address (paginated)
    pub fn get_certificates_by_owner(
        env: Env,
        owner: Address,
        pagination: Pagination,
    ) -> CertPaginatedResult {
        let ids: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::OwnerCertIds(owner))
            .unwrap_or(Vec::<String>::new(&env));
        Self::paginate_certificates(&env, ids, pagination)
    }

    fn paginate_certificates(
        env: &Env,
        cert_ids: Vec<String>,
        pagination: Pagination,
    ) -> CertPaginatedResult {
        let total = cert_ids.len();
        let mut page_data = Vec::<Certificate>::new(env);

        if pagination.limit == 0 {
            return CertPaginatedResult {
                data: page_data,
                total,
                page: pagination.page,
                limit: pagination.limit,
                has_next: false,
            };
        }

        let start = pagination.page.saturating_mul(pagination.limit);
        let end = total.min(start.saturating_add(pagination.limit));
        let mut index = start;
        while index < end {
            if let Some(id) = cert_ids.get(index) {
                if let Some(cert) = env
                    .storage()
                    .persistent()
                    .get::<_, Certificate>(&DataKey::Certificate(id))
                {
                    page_data.push_back(cert);
                }
            }
            index += 1;
        }

        CertPaginatedResult {
            data: page_data,
            total,
            page: pagination.page,
            limit: pagination.limit,
            has_next: end < total,
        }
    }

    fn append_cert_id(env: &Env, key: DataKey, cert_id: String) {
        let mut ids: Vec<String> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::<String>::new(env));
        if !ids.contains(&cert_id) {
            ids.push_back(cert_id);
            Self::set_persistent(env, &key, &ids);
        }
    }
    
    fn remove_cert_id(env: &Env, key: DataKey, cert_id: String) {
    let ids: Vec<String> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::<String>::new(env));

    let mut updated = Vec::<String>::new(env);

    for id in ids.iter() {
        if id != cert_id {
            updated.push_back(id);
        }
    }

    Self::set_persistent(env, &key, &updated);
}

    fn append_request_id(env: &Env, key: DataKey, request_id: String) {
        let mut request_ids = Self::get_request_ids(env, key.clone());

        if !request_ids.contains(&request_id) {
            request_ids.push_back(request_id);
            Self::set_persistent(env, &key, &request_ids);
        }
    }

    fn get_request_ids(env: &Env, key: DataKey) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::<String>::new(env))
    }

    fn paginate_requests(
        env: &Env,
        request_ids: Vec<String>,
        pagination: Pagination,
    ) -> PaginatedResult {
        let mut all_requests = Vec::<PendingRequest>::new(env);

        for request_id in request_ids.iter() {
            if let Some(request) = env
                .storage()
                .persistent()
                .get::<_, PendingRequest>(&DataKey::PendingRequest(request_id))
            {
                all_requests.push_back(request);
            }
        }

        let total = all_requests.len();
        let mut page_data = Vec::<PendingRequest>::new(env);

        if pagination.limit == 0 {
            return PaginatedResult {
                data: page_data,
                total,
                page: pagination.page,
                limit: pagination.limit,
                has_next: false,
            };
        }

        // Page is 1-indexed. Calculate start index (0-indexed)
        let start = pagination
            .page
            .saturating_sub(1)
            .saturating_mul(pagination.limit);
        let end = total.min(start.saturating_add(pagination.limit));

        let mut index = start;
        while index < end {
            if let Some(request) = all_requests.get(index) {
                page_data.push_back(request);
            }
            index += 1;
        }

        PaginatedResult {
            data: page_data,
            total,
            page: pagination.page,
            limit: pagination.limit,
            has_next: end < total,
        }
    }
}