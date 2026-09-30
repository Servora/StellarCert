use soroban_sdk::{contract, contractimpl, Address, Env, IntoVal, String, Symbol, Val, Vec};

use crate::{
    DataKey, MultisigConfig, OptionalRequestStatus, PaginatedResult, Pagination, PendingRequest,
    RequestStatus, SignatureResult,
};

#[contract]
pub struct MultisigCertificateContract;

#[contractimpl]
impl MultisigCertificateContract {
    fn set_instance<K, V>(env: &Env, key: &K, value: &V)
    where
        K: IntoVal<Env, Val>,
        V: IntoVal<Env, Val>,
    {
        env.storage().instance().set(key, value);
        crate::persistent::extend_instance_ttl(env, None);
    }

    /// Initialize the contract with a global admin. Can only be called once.
    /// Initializes the contract admin. See `CertificateContract::initialize`
    /// for why `require_auth` alone does not close the deploy-to-init race.
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Admin already initialized");
        }
        Self::set_instance(&env, &DataKey::Admin, &admin);
    }

    /// Initialize multisig configuration for an issuer
    #[allow(clippy::too_many_arguments)] // Soroban contract entry points cannot use struct params
    pub fn init_multisig_config(
        env: Env,
        issuer: Address,
        threshold: u32,
        signers: Vec<Address>,
        max_signers: u32,
        admin: Address,
    ) {
        admin.require_auth();

        // Validate parameters
        #[allow(clippy::unnecessary_cast)]
        if threshold == 0
            || signers.is_empty()
            || threshold > signers.len() as u32
            || max_signers < threshold
        {
            panic!("Invalid multisig parameters");
        }

        // Check if already initialized
        if env
            .storage()
            .instance()
            .has(&DataKey::MultisigConfig(issuer.clone()))
        {
            panic!("Multisig config already exists for this issuer");
        }

        // Store configuration
        Self::set_instance(
            &env,
            &DataKey::MultisigConfig(issuer.clone()),
            &MultisigConfig {
                threshold,
                signers,
                max_signers,
            },
        );

        // Store admin for this issuer
        Self::set_instance(&env, &DataKey::IssuerAdmin(issuer), &admin);
    }

    /// Update multisig configuration
    pub fn update_multisig_config(
        env: Env,
        issuer: Address,
        new_threshold: Option<u32>,
        new_signers: Option<Vec<Address>>,
        new_max_signers: Option<u32>,
    ) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::IssuerAdmin(issuer.clone()))
            .expect("Issuer admin not found");
        admin.require_auth();

        let mut config: MultisigConfig = env
            .storage()
            .instance()
            .get(&DataKey::MultisigConfig(issuer.clone()))
            .expect("Multisig config not found");

        // Update configuration
        if let Some(signers) = new_signers {
            config.signers = signers;
        }
        if let Some(threshold) = new_threshold {
            config.threshold = threshold;
        }
        if let Some(max_signers) = new_max_signers {
            config.max_signers = max_signers;
        }

        // Validate updated configuration
        #[allow(clippy::unnecessary_cast)]
        if config.threshold == 0
            || config.signers.is_empty()
            || config.threshold > config.signers.len() as u32
            || config.max_signers < config.threshold
        {
            panic!("Invalid updated multisig parameters");
        }

        Self::set_instance(&env, &DataKey::MultisigConfig(issuer), &config);
    }

    /// Get multisig configuration for an issuer
    pub fn get_multisig_config(env: Env, issuer: Address) -> MultisigConfig {
        env.storage()
            .instance()
            .get(&DataKey::MultisigConfig(issuer))
            .expect("Multisig config not found")
    }

    /// Propose a certificate for multisig approval
    pub fn propose_certificate(
        env: Env,
        request_id: String,
        issuer: Address,
        recipient: Address,
        metadata: String,
        expiration_days: u32,
    ) -> PendingRequest {
        // Without this anyone could raise requests in an issuer's name and
        // fill every signer's SignerRequestIds list with junk. The lib.rs
        // counterpart has always required it; this one did not.
        issuer.require_auth();

        // An issuer with no multisig configuration is not an issuer this
        // contract recognises. Reported as an authorization failure rather
        // than a missing-config detail.
        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&DataKey::MultisigConfig(issuer.clone()))
            .expect("Issuer is not authorized: no multisig configuration");

        // Check if request already exists
        if env
            .storage()
            .instance()
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
            expires_at: env.ledger().timestamp() + (expiration_days as u64 * 24 * 60 * 60), // Convert days to seconds
            status: RequestStatus::Pending,
        };

        Self::set_instance(&env, &DataKey::PendingRequest(request_id.clone()), &request);

        Self::append_request_id(&env, DataKey::IssuerRequestIds(issuer), request_id.clone());

        for signer in config.signers.iter() {
            Self::append_request_id(&env, DataKey::SignerRequestIds(signer), request_id.clone());
        }

        request
    }

    /// Approve a pending certificate request
    pub fn approve_request(env: Env, request_id: String, approver: Address) -> SignatureResult {
        approver.require_auth();

        let mut request: PendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::PendingRequest(request_id.clone()))
            .expect("Request not found");

        // Check if request has expired
        if env.ledger().timestamp() > request.expires_at {
            request.status = RequestStatus::Expired;
            Self::set_instance(&env, &DataKey::PendingRequest(request_id), &request);
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Request has expired"),
                final_status: OptionalRequestStatus::Some(RequestStatus::Expired),
            };
        }

        // Check if request is still pending
        if request.status != RequestStatus::Pending {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Request is not pending"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        // Get multisig configuration
        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&DataKey::MultisigConfig(request.issuer.clone()))
            .expect("Multisig config not found");

        // Check if approver is an authorized signer
        if !config.signers.contains(&approver) {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Approver is not an authorized signer"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        // Check if already approved
        if request.approvals.contains(&approver) {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Request already approved by this signer"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        // Add approval
        request.approvals.push_back(approver);

        // Check if threshold is reached
        if request.approvals.len() >= config.threshold {
            request.status = RequestStatus::Approved;
        }

        Self::set_instance(&env, &DataKey::PendingRequest(request_id), &request);

        SignatureResult {
            success: true,
            message: String::from_str(&env, "Approval recorded"),
            final_status: OptionalRequestStatus::Some(request.status),
        }
    }

    /// Reject a pending certificate request
    pub fn reject_request(
        env: Env,
        request_id: String,
        rejector: Address,
        reason: Option<String>,
    ) -> SignatureResult {
        rejector.require_auth();

        let mut request: PendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::PendingRequest(request_id.clone()))
            .expect("Request not found");

        // Check if request is still pending
        if request.status != RequestStatus::Pending {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Request is not pending"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        // Get multisig configuration
        let config: MultisigConfig = env
            .storage()
            .instance()
            .get(&DataKey::MultisigConfig(request.issuer.clone()))
            .expect("Multisig config not found");

        // Check if rejector is an authorized signer
        if !config.signers.contains(&rejector) {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Rejector is not an authorized signer"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        // Check if already rejected
        if request.rejections.contains(&rejector) {
            return SignatureResult {
                success: false,
                message: String::from_str(&env, "Request already rejected by this signer"),
                final_status: OptionalRequestStatus::Some(request.status),
            };
        }

        // Add rejection
        request.rejections.push_back(rejector);
        if reason.is_some() {
            request.rejection_reason = reason;
        }

        let remaining_eligible_approvers = config
            .signers
            .len()
            .saturating_sub(request.rejections.len());
        if remaining_eligible_approvers < config.threshold {
            request.status = RequestStatus::Rejected;
        }

        Self::set_instance(&env, &DataKey::PendingRequest(request_id), &request);

        SignatureResult {
            success: true,
            message: String::from_str(&env, "Rejection recorded"),
            final_status: OptionalRequestStatus::Some(request.status),
        }
    }

    /// Issue an approved certificate
    pub fn issue_approved_certificate(env: Env, request_id: String) -> bool {
        let mut request: PendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::PendingRequest(request_id.clone()))
            .expect("Request not found");

        if request.status != RequestStatus::Approved {
            return false;
        }

        request.issuer.require_auth();

        let certificate_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::CertificateContract)
            .expect("Certificate contract not configured");

        // Issue the actual certificate through the external CertificateContract
        let _: () = env.invoke_contract(
            &certificate_contract,
            &Symbol::new(&env, "issue_certificate"),
            soroban_sdk::vec![
                &env,
                request.id.clone().into_val(&env),
                request.issuer.clone().into_val(&env),
                request.recipient.clone().into_val(&env),
                request.metadata.clone().into_val(&env),
                Some(request.expires_at).into_val(&env),
            ],
        );

        request.status = RequestStatus::Issued;
        Self::set_instance(&env, &DataKey::PendingRequest(request_id), &request);
        true
    }

    pub fn set_certificate_contract(env: Env, certificate_contract: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized");
        admin.require_auth();
        Self::set_instance(&env, &DataKey::CertificateContract, &certificate_contract);
    }

    pub fn get_certificate_contract(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::CertificateContract)
            .expect("Certificate contract not configured")
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Contract not initialized")
    }

    /// Get a pending request by ID
    /// Reads a pending request.
    ///
    /// Takes a `caller` and enforces the same access control as the `lib.rs`
    /// counterpart. Previously this was world-readable, so anyone could
    /// enumerate requests — including recipient addresses and metadata — for
    /// any issuer.
    pub fn get_pending_request(env: Env, request_id: String, caller: Address) -> PendingRequest {
        caller.require_auth();

        let request: PendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::PendingRequest(request_id))
            .expect("Request not found");

        // The admin is one authorized role among several. If none is set the
        // branch simply cannot match — an uninitialized admin must not make
        // the request unreadable to the issuer, proposer or its signers.
        let admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);

        // Only the issuer, the proposer, the admin, or one of the issuer's
        // configured signers may read a request.
        let is_authorized = caller == request.issuer
            || caller == request.proposer
            || admin.is_some_and(|a| a == caller)
            || env
                .storage()
                .instance()
                .get::<_, MultisigConfig>(&DataKey::MultisigConfig(request.issuer.clone()))
                .is_some_and(|c| c.signers.contains(&caller));

        if !is_authorized {
            panic!("Not authorized to view this request");
        }

        request
    }

    /// Check if a request has expired
    pub fn is_expired(env: Env, request_id: String) -> bool {
        let request: PendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::PendingRequest(request_id))
            .expect("Request not found");
        env.ledger().timestamp() > request.expires_at
    }

    /// Cancel a pending request (only proposer can cancel)
    pub fn cancel_request(env: Env, request_id: String, requester: Address) -> bool {
        requester.require_auth();

        let mut request: PendingRequest = env
            .storage()
            .instance()
            .get(&DataKey::PendingRequest(request_id.clone()))
            .expect("Request not found");

        if request.proposer != requester {
            panic!("Only proposer can cancel the request");
        }

        if request.status != RequestStatus::Pending {
            return false;
        }

        request.status = RequestStatus::Cancelled;
        Self::set_instance(&env, &DataKey::PendingRequest(request_id), &request);
        true
    }

    /// Get pending requests for an issuer (simplified pagination)
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

    /// Get pending requests for a signer (simplified pagination)
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

    fn append_request_id(env: &Env, key: DataKey, request_id: String) {
        let mut request_ids = Self::get_request_ids(env, key.clone());

        if !request_ids.contains(&request_id) {
            request_ids.push_back(request_id);
            Self::set_instance(env, &key, &request_ids);
        }
    }

    fn get_request_ids(env: &Env, key: DataKey) -> Vec<String> {
        env.storage()
            .instance()
            .get(&key)
            .unwrap_or(Vec::<String>::new(env))
    }

    fn paginate_requests(
        env: &Env,
        request_ids: Vec<String>,
        pagination: Pagination,
    ) -> PaginatedResult {
        let mut pending_requests = Vec::<PendingRequest>::new(env);

        for request_id in request_ids.iter() {
            if let Some(request) = env
                .storage()
                .instance()
                .get::<_, PendingRequest>(&DataKey::PendingRequest(request_id))
            {
                if request.status == RequestStatus::Pending {
                    pending_requests.push_back(request);
                }
            }
        }

        let total = pending_requests.len();
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
            if let Some(request) = pending_requests.get(index) {
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
