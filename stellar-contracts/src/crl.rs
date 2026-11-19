use soroban_sdk::{
    contract, contractevent, contracttype, Address, Bytes, BytesN, Env, IntoVal, String, Val, Vec,
};

const DEFAULT_UPDATE_WINDOW_SECONDS: u64 = 7 * 24 * 60 * 60;

/// Hard ceiling on the `limit` argument of paginated views. Mirrors the cap
/// used by the certificate contract's listings so a caller cannot force a
/// single invocation to walk the entire revocation list and exhaust the
/// transaction's compute budget.
const MAX_PAGE_SIZE: u32 = 100;

/// Longest certificate ID accepted into the CRL Merkle tree. Leaves are hashed
/// from a fixed-size stack buffer, so longer IDs are rejected explicitly.
const MAX_CERTIFICATE_ID_LEN: usize = 256;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RevocationReason {
    KeyCompromise = 0,
    CACompromise = 1,
    AffiliationChanged = 2,
    Superseded = 3,
    CessationOfOperation = 4,
    CertificateHold = 5,
    PrivilegeWithdrawn = 6,
    AACompromise = 7,
    /// Neutral fallback used when a free-form reason string mirrored from the
    /// certificate contract cannot be mapped to one of the codes above. Kept at
    /// 8 so the existing on-chain codes (0-7) stay stable.
    Unspecified = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevocationInfo {
    pub certificate_id: String,
    pub reason: u32,
    pub issuer: Address,
    pub revocation_date: u64,
    pub revoked_by: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CRLInfo {
    pub issuer: Address,
    pub revoked_count: u32,
    pub crl_number: u64,
    pub this_update: u64,
    pub next_update: u64,
    pub merkle_root: String,
}

/// Emitted by [`CRLContract::revoke_certificate`] once the revocation has been
/// stored and the CRL head refreshed.
///
/// Before this event existed a revocation was only observable by polling
/// `is_revoked`/`get_revocation_info`, so the backend webhook system and
/// off-chain indexers had no on-chain signal to trigger a certificate status
/// update. The payload carries both the revocation itself and the new CRL head
/// (`revoked_count`, `crl_number`, `merkle_root`, `this_update`, `next_update`)
/// so a subscriber can update its local CRL copy from the event alone, and can
/// detect a CRL that has fallen out of sync with the contract.
///
/// Topics: `("crl", "revoked", <certificate_id>)`.
/// Topics: `("crl", "revoked", <certificate_id>)`.
///
/// Declared with `#[contractevent]` so the topic list and payload shape are
/// checked at compile time and published into the contract spec. The migration
/// is wire-compatible with the `env.events().publish(...)` call it replaces: as
/// with the events in `types.rs`, the old call published the certificate id as
/// the third topic *and* inside the payload, so a `#[topic]` copy of it is
/// carried alongside the `certificate_id` that stays in the data map. Both must
/// be set to the same value; `events_test` asserts the full wire form.
#[contractevent(topics = ["crl", "revoked"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CRLRevocationAddedEvent {
    /// Copy of `certificate_id` published as the third topic.
    #[topic]
    pub topic_certificate_id: String,
    pub certificate_id: String,
    pub reason: u32,
    pub revoked_by: Address,
    pub revocation_date: u64,
    pub revoked_count: u32,
    pub crl_number: u64,
    pub merkle_root: String,
    pub this_update: u64,
    pub next_update: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Issuer,
    Admin,
    Info,
    Revocation(String),
    RevokedCertificates,
    CertContract,
    RevokedCertificate(u32),
    MerkleFrontier,
}

#[contract]
pub struct CRLContract;

// Exported only when this contract is the one being built; see Cargo.toml.
#[cfg_attr(
    any(not(target_family = "wasm"), feature = "crl"),
    soroban_sdk::contractimpl
)]
impl CRLContract {
    fn set_persistent<K, V>(env: &Env, key: &K, value: &V)
    where
        K: IntoVal<Env, Val>,
        V: IntoVal<Env, Val>,
    {
        env.storage().persistent().set(key, value);
        crate::persistent::extend_ttl(env, key, None);
    }

    fn set_instance<K, V>(env: &Env, key: &K, value: &V)
    where
        K: IntoVal<Env, Val>,
        V: IntoVal<Env, Val>,
    {
        env.storage().instance().set(key, value);
        crate::persistent::extend_instance_ttl(env, None);
    }

    pub fn initialize(env: Env, issuer: Address, certificate_contract: Address) {
        if env.storage().persistent().has(&DataKey::Issuer) {
            panic!("CRL already initialized");
        }

        issuer.require_auth();

        let now = env.ledger().timestamp();
        let crl_info = CRLInfo {
            issuer: issuer.clone(),
            revoked_count: 0,
            crl_number: 1,
            this_update: now,
            next_update: now + DEFAULT_UPDATE_WINDOW_SECONDS,
            merkle_root: Self::empty_merkle_root(&env),
        };

        Self::set_persistent(&env, &DataKey::Issuer, &issuer);
        Self::set_persistent(&env, &DataKey::CertContract, &certificate_contract);
        Self::set_persistent(
            &env,
            &DataKey::MerkleFrontier,
            &Vec::<Option<BytesN<32>>>::new(&env),
        );
        Self::set_persistent(&env, &DataKey::Info, &crl_info);
    }

    pub fn revoke_certificate(
        env: Env,
        authorizer: Address,
        certificate_id: String,
        reason: RevocationReason,
        serial_number: Option<String>,
    ) {
        let issuer = Self::get_issuer(&env);
        // Allow either the configured issuer or an admin to authorize revocations
        let mut authorized = false;
        if authorizer == issuer {
            authorized = true;
        } else if let Some(admin) = Self::get_admin(&env) {
            if authorizer == admin {
                authorized = true;
            }
        }

        if !authorized {
            panic!("Only issuer or admin can revoke");
        }

        authorizer.require_auth();

        // Verify the certificate exists in the CertificateContract (#414)
        let cert_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::CertContract)
            .expect("CRL not initialized");
        let cert_exists: bool = env.invoke_contract(
            &cert_contract,
            &soroban_sdk::Symbol::new(&env, "certificate_exists"),
            soroban_sdk::vec![&env, certificate_id.clone().into_val(&env)],
        );
        if !cert_exists {
            panic!("Certificate does not exist");
        }

        Self::record_revocation(&env, &authorizer, &certificate_id, reason, serial_number);
    }

    /// Record a revocation mirrored from `CertificateContract::revoke_certificate`.
    ///
    /// The certificate contract has already authenticated the issuer and loaded
    /// the certificate, and Soroban forbids it re-entering the certificate
    /// contract, so the `certificate_exists` check used by
    /// [`Self::revoke_certificate`] cannot run here. The caller is authenticated
    /// directly instead: only the configured certificate contract can use this
    /// entry point.
    pub fn revoke_certificate_mirrored(
        env: Env,
        issuer: Address,
        certificate_id: String,
        reason: RevocationReason,
        serial_number: Option<String>,
    ) {
        let cert_contract: Address = env
            .storage()
            .persistent()
            .get(&DataKey::CertContract)
            .expect("CRL not initialized");
        cert_contract.require_auth();

        Self::record_revocation(&env, &issuer, &certificate_id, reason, serial_number);
    }

    /// Shared revocation bookkeeping used by both public entry points.
    fn record_revocation(
        env: &Env,
        revoked_by: &Address,
        certificate_id: &String,
        reason: RevocationReason,
        _serial_number: Option<String>,
    ) {
        let issuer = Self::get_issuer(env);

        let revocation_key = DataKey::Revocation(certificate_id.clone());
        if env.storage().persistent().has(&revocation_key) {
            panic!("Certificate already revoked");
        }

        let mut crl_info = Self::get_crl_info_internal(env);
        let revocation_info = RevocationInfo {
            certificate_id: certificate_id.clone(),
            reason: reason as u32,
            issuer: issuer.clone(),
            revocation_date: env.ledger().timestamp(),
            revoked_by: revoked_by.clone(),
        };

        Self::set_persistent(env, &revocation_key, &revocation_info);

        Self::set_persistent(
            env,
            &DataKey::RevokedCertificate(crl_info.revoked_count),
            certificate_id,
        );
        crl_info.merkle_root = Self::append_merkle_leaf(env, certificate_id);
        crl_info.revoked_count += 1;
        Self::refresh_crl_info(env, &mut crl_info);
        Self::set_persistent(env, &DataKey::Info, &crl_info);

        // Announce the revocation only after every storage write succeeded, so
        // the event always describes state that can be read back: an indexer
        // that reacts to it will find the revocation and the CRL head it names.
        //
        // This deliberately lives in `record_revocation` rather than in
        // `revoke_certificate`: a revocation mirrored from the certificate
        // contract goes through `revoke_certificate_mirrored`, and both paths
        // must publish exactly the same event — an indexer must not be able to
        // tell them apart.
        CRLRevocationAddedEvent {
            topic_certificate_id: certificate_id.clone(),
            certificate_id: certificate_id.clone(),
            reason: revocation_info.reason,
            revoked_by: revocation_info.revoked_by.clone(),
            revocation_date: revocation_info.revocation_date,
            revoked_count: crl_info.revoked_count,
            crl_number: crl_info.crl_number,
            merkle_root: crl_info.merkle_root.clone(),
            this_update: crl_info.this_update,
            next_update: crl_info.next_update,
        }
        .publish(env);
    }

    pub fn is_revoked(env: Env, certificate_id: String) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Revocation(certificate_id))
    }

    pub fn get_revocation_info(env: Env, certificate_id: String) -> Option<RevocationInfo> {
        env.storage()
            .persistent()
            .get(&DataKey::Revocation(certificate_id))
    }

    pub fn get_revoked_count(env: Env) -> u32 {
        Self::get_crl_info_internal(&env).revoked_count
    }

    pub fn get_crl_info(env: Env) -> CRLInfo {
        Self::get_crl_info_internal(&env)
    }

    /// Page numbers are 1-indexed: the first page is `1` (a `page` of `0` is
    /// normalized to the first page). This matches the pagination used by the
    /// certificate contract's listings, so a client can use the same paging
    /// convention for both contracts without skipping pages.
    pub fn get_revoked_certificates(env: Env, page: u32, limit: u32) -> Vec<RevocationInfo> {
        if limit > MAX_PAGE_SIZE {
            panic!("Pagination limit exceeds maximum allowed");
        }

        let mut page_of_revocations = Vec::new(&env);

        if limit == 0 {
            return page_of_revocations;
        }

        let start = page.saturating_sub(1).saturating_mul(limit);
        let mut end = start.saturating_add(limit);
        let total = Self::get_crl_info_internal(&env).revoked_count;
        if end > total {
            end = total;
        }

        let mut index = start;
        while index < end {
            let certificate_id: String = env
                .storage()
                .persistent()
                .get(&DataKey::RevokedCertificate(index))
                .expect("Revoked certificate index not found");
            if let Some(revocation_info) = env
                .storage()
                .persistent()
                .get(&DataKey::Revocation(certificate_id))
            {
                page_of_revocations.push_back(revocation_info);
            }
            index += 1;
        }

        page_of_revocations
    }

    pub fn verify_certificate(env: Env, certificate_id: String) -> (bool, u64) {
        let crl_info = Self::get_crl_info_internal(&env);
        let is_revoked = env
            .storage()
            .persistent()
            .has(&DataKey::Revocation(certificate_id));

        (is_revoked, crl_info.crl_number)
    }

    pub fn get_merkle_root(env: Env) -> String {
        Self::get_crl_info_internal(&env).merkle_root
    }

    pub fn update_crl_metadata(env: Env, next_update: Option<u64>, issuer: Option<Address>) {
        let crl_issuer = Self::get_issuer(&env);

        // Only the CRL owner or a configured admin may update CRL metadata.
        // When an explicit issuer is supplied it must be one of those; otherwise
        // fall back to the CRL owner, still requiring its authorization.
        let authorizer = match issuer {
            Some(candidate) => {
                let is_owner = candidate == crl_issuer;
                let is_admin = Self::get_admin(&env)
                    .map(|admin| admin == candidate)
                    .unwrap_or(false);
                if !is_owner && !is_admin {
                    panic!("Only issuer or admin can update CRL metadata");
                }
                candidate
            }
            None => crl_issuer,
        };
        authorizer.require_auth();

        let mut crl_info = Self::get_crl_info_internal(&env);
        if let Some(new_next_update) = next_update {
            crl_info.next_update = new_next_update;
        }

        Self::refresh_crl_info(&env, &mut crl_info);
        Self::set_persistent(&env, &DataKey::Info, &crl_info);
    }

    /// Set an admin address that can authorize revocations/unrevocations
    pub fn set_admin(env: Env, admin: Address) {
        let issuer = Self::get_issuer(&env);
        issuer.require_auth();
        Self::set_instance(&env, &DataKey::Admin, &admin);
    }

    pub fn needs_update(env: Env) -> bool {
        env.ledger().timestamp() >= Self::get_crl_info_internal(&env).next_update
    }

    fn get_issuer(env: &Env) -> Address {
        env.storage()
            .persistent()
            .get(&DataKey::Issuer)
            .expect("CRL not initialized")
    }

    fn get_crl_info_internal(env: &Env) -> CRLInfo {
        env.storage()
            .persistent()
            .get(&DataKey::Info)
            .expect("CRL info not found")
    }

    fn get_admin(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    fn refresh_crl_info(env: &Env, crl_info: &mut CRLInfo) {
        crl_info.crl_number += 1;
        crl_info.this_update = env.ledger().timestamp();
    }

    fn empty_merkle_root(env: &Env) -> String {
        let empty_hash: BytesN<32> = env.crypto().sha256(&Bytes::new(env)).into();
        Self::hash_to_hex(env, &empty_hash)
    }

    fn append_merkle_leaf(env: &Env, id: &String) -> String {
        let len = id.len() as usize;
        // An over-long ID would otherwise panic on an out-of-bounds slice. Only
        // this revocation fails; previously recorded revocations are unaffected.
        if len > MAX_CERTIFICATE_ID_LEN {
            panic!("Certificate ID exceeds maximum length");
        }
        let mut leaf_data = [0u8; MAX_CERTIFICATE_ID_LEN + 1];
        leaf_data[0] = 0;
        id.copy_into_slice(&mut leaf_data[1..len + 1]);
        let leaf_hash: BytesN<32> = env
            .crypto()
            .sha256(&Bytes::from_slice(env, &leaf_data[..len + 1]))
            .into();

        let mut frontier: Vec<Option<BytesN<32>>> = env
            .storage()
            .persistent()
            .get(&DataKey::MerkleFrontier)
            .expect("Merkle frontier not initialized");
        let mut current = leaf_hash;
        let mut level = 0u32;

        loop {
            match frontier.get(level) {
                Some(Some(left)) => {
                    current = Self::hash_node(env, &left, &current);
                    frontier.set(level, None);
                    level += 1;
                }
                Some(None) => {
                    frontier.set(level, Some(current));
                    break;
                }
                None => {
                    frontier.push_back(Some(current));
                    break;
                }
            }
        }

        Self::set_persistent(env, &DataKey::MerkleFrontier, &frontier);

        let mut root: Option<BytesN<32>> = None;
        let mut index = frontier.len();
        // Walk from the highest level down: higher-level peaks cover earlier
        // leaves, so the accumulated root is always the left operand and each
        // smaller peak to its right is promoted as the right operand.
        while index > 0 {
            index -= 1;
            if let Some(Some(peak)) = frontier.get(index) {
                root = Some(match root {
                    Some(left) => Self::hash_node(env, &left, &peak),
                    None => peak,
                });
            }
        }

        Self::hash_to_hex(env, &root.expect("Merkle frontier is empty"))
    }

    fn hash_node(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
        let mut combined = [0u8; 65];
        combined[0] = 1;
        combined[1..33].copy_from_slice(&left.to_array());
        combined[33..].copy_from_slice(&right.to_array());
        env.crypto()
            .sha256(&Bytes::from_slice(env, &combined))
            .into()
    }

    fn hash_to_hex(env: &Env, hash: &BytesN<32>) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let arr = hash.to_array();
        let mut out = [0u8; 64];
        let mut i = 0usize;
        while i < 32 {
            out[i * 2] = HEX[(arr[i] >> 4) as usize];
            out[i * 2 + 1] = HEX[(arr[i] & 0xf) as usize];
            i += 1;
        }
        // SAFETY: out contains only ASCII hex chars (0-9, a-f)
        String::from_str(env, unsafe { core::str::from_utf8_unchecked(&out) })
    }
}

#[cfg(test)]
mod admin_storage_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env};

    /// Regression test for #749: `set_admin` and `get_admin` must target the
    /// same storage backend, otherwise a written admin can never be read back
    /// and every admin authorization check silently fails.
    #[test]
    fn set_admin_round_trips_through_get_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(CRLContract, ());
        let client = CRLContractClient::new(&env, &contract_id);

        let issuer = Address::generate(&env);
        let cert_contract = Address::generate(&env);
        client.initialize(&issuer, &cert_contract);

        // Before any admin is configured the read must come back empty.
        let read_admin = || env.as_contract(&contract_id, || CRLContract::get_admin(&env));
        assert_eq!(read_admin(), None);

        let admin = Address::generate(&env);
        client.set_admin(&admin);

        // The exact value written by set_admin must be observable by get_admin.
        assert_eq!(read_admin(), Some(admin));
    }
}
