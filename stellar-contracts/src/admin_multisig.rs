use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, String, Val,
    Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminAction {
    UpgradeContract(BytesN<32>),
    RemoveIssuer(Address),
    UpdateConfig(u32, Vec<Address>, u32),
    Other(String),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminMultisigConfig {
    pub threshold: u32,
    pub signers: Vec<Address>,
    pub proposal_window: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminProposalStatus {
    Pending,
    Approved,
    Executed,
    Expired,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminProposal {
    pub id: String,
    pub action: AdminAction,
    pub proposer: Address,
    pub approvals: Vec<Address>,
    pub created_ledger: u32,
    pub expires_at_ledger: u32,
    pub status: AdminProposalStatus,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCreatedEvent {
    pub proposal_id: String,
    pub proposer: Address,
    pub expires_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalApprovedEvent {
    pub proposal_id: String,
    pub approver: Address,
    pub approval_count: u32,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCanceledEvent {
    pub proposal_id: String,
    pub proposer: Address,
}

#[contract]
pub struct AdminMultisigContract;

#[contractimpl]
impl AdminMultisigContract {
    fn set_instance<K, V>(env: &Env, key: &K, value: &V)
    where
        K: IntoVal<Env, Val>,
        V: IntoVal<Env, Val>,
    {
        env.storage().instance().set(key, value);
        crate::persistent::extend_instance_ttl(env, None);
    }

    pub fn init_admin_multisig(
        env: Env,
        threshold: u32,
        signers: Vec<Address>,
        proposal_window: u32,
    ) {
        Self::validate_config(&signers, threshold, proposal_window);

        if env
            .storage()
            .instance()
            .has(&AdminMultisigDataKey::AdminConfig)
        {
            panic!("Admin multisig already initialized");
        }

        Self::set_instance(
            &env,
            &AdminMultisigDataKey::AdminConfig,
            &AdminMultisigConfig {
                threshold,
                signers,
                proposal_window,
            },
        );
    }

    pub fn get_config(env: Env) -> AdminMultisigConfig {
        env.storage()
            .instance()
            .get(&AdminMultisigDataKey::AdminConfig)
            .expect("Admin multisig not initialized")
    }

    pub fn propose_action(
        env: Env,
        proposal_id: String,
        proposer: Address,
        action: AdminAction,
    ) -> AdminProposal {
        proposer.require_auth();

        let config = Self::get_config(env.clone());
        Self::require_signer(&config.signers, &proposer);

        let proposal_key = AdminMultisigDataKey::AdminProposal(proposal_id.clone());
        if env.storage().instance().has(&proposal_key) {
            panic!("Proposal already exists");
        }

        let created_ledger = env.ledger().sequence();
        let expires_at_ledger = created_ledger.saturating_add(config.proposal_window);

        let proposal = AdminProposal {
            id: proposal_id.clone(),
            action,
            proposer: proposer.clone(),
            approvals: Vec::new(&env),
            created_ledger,
            expires_at_ledger,
            status: AdminProposalStatus::Pending,
        };

        Self::set_instance(&env, &proposal_key, &proposal);
        env.events().publish(
            (symbol_short!("proposal"), symbol_short!("created")),
            ProposalCreatedEvent {
                proposal_id,
                proposer,
                expires_at_ledger,
            },
        );

        proposal
    }

    pub fn approve_action(env: Env, proposal_id: String, approver: Address) -> AdminProposalStatus {
        approver.require_auth();

        let config = Self::get_config(env.clone());
        Self::require_signer(&config.signers, &approver);

        let proposal_key = AdminMultisigDataKey::AdminProposal(proposal_id.clone());
        let mut proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&proposal_key)
            .expect("Proposal not found");

        if proposal.status != AdminProposalStatus::Pending {
            panic!("Proposal is not pending");
        }

        let current_ledger = env.ledger().sequence();
        if current_ledger > proposal.expires_at_ledger {
            proposal.status = AdminProposalStatus::Expired;
            Self::set_instance(&env, &proposal_key, &proposal);
            return AdminProposalStatus::Expired;
        }

        if proposal.proposer == approver {
            panic!("Proposer cannot approve their own action");
        }

        if proposal.approvals.contains(&approver) {
            panic!("Already approved by this signer");
        }

        proposal.approvals.push_back(approver.clone());
        let approval_count = proposal.approvals.len();

        env.events().publish(
            (symbol_short!("proposal"), symbol_short!("approved")),
            ProposalApprovedEvent {
                proposal_id: proposal_id.clone(),
                approver,
                approval_count,
                threshold: config.threshold,
            },
        );

        let mut status = AdminProposalStatus::Pending;
        if approval_count >= config.threshold {
            proposal.status = AdminProposalStatus::Approved;
            status = AdminProposalStatus::Approved;
        }

        Self::set_instance(&env, &proposal_key, &proposal);

        if status == AdminProposalStatus::Approved {
            status = Self::execute_action(env, proposal_id);
        }

        status
    }

    pub fn cancel_proposal(env: Env, proposal_id: String, proposer: Address) {
        proposer.require_auth();

        let proposal_key = AdminMultisigDataKey::AdminProposal(proposal_id.clone());
        let mut proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&proposal_key)
            .expect("Proposal not found");

        if proposal.proposer != proposer {
            panic!("Only proposer can cancel");
        }

        if proposal.status != AdminProposalStatus::Pending {
            panic!("Proposal is not pending");
        }

        proposal.status = AdminProposalStatus::Rejected;
        Self::set_instance(&env, &proposal_key, &proposal);

        env.events().publish(
            (symbol_short!("proposal"), symbol_short!("canceled")),
            ProposalCanceledEvent {
                proposal_id,
                proposer,
            },
        );
    }

    pub fn get_proposal(env: Env, proposal_id: String) -> AdminProposal {
        env.storage()
            .instance()
            .get(&AdminMultisigDataKey::AdminProposal(proposal_id))
            .expect("Proposal not found")
    }

    pub fn is_issuer_removed(env: Env, issuer: Address) -> bool {
        env.storage()
            .instance()
            .get(&AdminMultisigDataKey::RemovedIssuer(issuer))
            .unwrap_or(false)
    }

    pub fn propose_admin_action(
        env: Env,
        proposal_id: String,
        proposer: Address,
        action: AdminAction,
    ) -> AdminProposal {
        Self::propose_action(env, proposal_id, proposer, action)
    }

    pub fn approve_admin_action(
        env: Env,
        proposal_id: String,
        approver: Address,
    ) -> AdminProposalStatus {
        Self::approve_action(env, proposal_id, approver)
    }

    pub fn set_admin_certificate_contract(env: Env, signer: Address, certificate_contract: Address) {
        signer.require_auth();

        let config = Self::get_config(env.clone());
        Self::require_signer(&config.signers, &signer);

        Self::set_instance(
            &env,
            &AdminMultisigDataKey::CertificateContractId,
            &certificate_contract,
        );
    }

    pub fn get_admin_certificate_contract(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&AdminMultisigDataKey::CertificateContractId)
            .expect("Certificate contract not configured")
    }

    fn execute_action(env: Env, proposal_id: String) -> AdminProposalStatus {
        let proposal_key = AdminMultisigDataKey::AdminProposal(proposal_id.clone());
        let mut proposal: AdminProposal = env
            .storage()
            .instance()
            .get(&proposal_key)
            .expect("Proposal not found");

        if proposal.status != AdminProposalStatus::Approved {
            panic!("Proposal is not approved");
        }

        match &proposal.action {
            AdminAction::UpgradeContract(wasm_hash) => {
                env.deployer()
                    .update_current_contract_wasm(wasm_hash.clone());
            }
            AdminAction::RemoveIssuer(issuer) => {
                Self::set_instance(
                    &env,
                    &AdminMultisigDataKey::RemovedIssuer(issuer.clone()),
                    &true,
                );

                let certificate_contract: Address = env
                    .storage()
                    .instance()
                    .get(&AdminMultisigDataKey::CertificateContractId)
                    .expect("Certificate contract not configured");

                let _: () = env.invoke_contract(
                    &certificate_contract,
                    &soroban_sdk::Symbol::new(&env, "remove_issuer"),
                    soroban_sdk::vec![&env, issuer.clone().into_val(&env)],
                );
            }
            AdminAction::UpdateConfig(threshold, signers, proposal_window) => {
                Self::validate_config(signers, *threshold, *proposal_window);
                Self::set_instance(
                    &env,
                    &AdminMultisigDataKey::AdminConfig,
                    &AdminMultisigConfig {
                        threshold: *threshold,
                        signers: signers.clone(),
                        proposal_window: *proposal_window,
                    },
                );
            }
            AdminAction::Other(_) => {}
        }

        proposal.status = AdminProposalStatus::Executed;
        Self::set_instance(&env, &proposal_key, &proposal);
        env.events().publish(
            (symbol_short!("proposal"), symbol_short!("executed")),
            proposal_id,
        );

        AdminProposalStatus::Executed
    }

    fn require_signer(signers: &Vec<Address>, signer: &Address) {
        if !signers.contains(signer) {
            panic!("Not an authorized admin signer");
        }
    }

    fn validate_config(signers: &Vec<Address>, threshold: u32, proposal_window: u32) {
        #[allow(clippy::unnecessary_cast)]
        if signers.is_empty() || threshold == 0 || threshold > signers.len() as u32 {
            panic!("Invalid admin multisig configuration");
        }

        if proposal_window == 0 {
            panic!("Proposal window must be greater than zero");
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminMultisigDataKey {
    AdminConfig,
    AdminProposal(String),
    CertificateContractId,
    RemovedIssuer(Address),
}
