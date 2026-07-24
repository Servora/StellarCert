use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal, String, Val, Vec,
};

const DEFAULT_UPDATE_WINDOW_SECONDS: u64 = 7 * 24 * 60 * 60;

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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Issuer,
    Admin,
    Info,
    Revocation(String),
    RevokedCertificates,
    CertContract,
}

#[contract]
pub struct CRLContract;

#[contractimpl]
impl CRLContract {
    fn set_persistent<K, V>(env: &Env, key: &K, value: &V)
    where
        K: IntoVal<Env, Val>,
        V: IntoVal<Env, Val>,
    {
        env.storage().persistent().set(key, value);
        crate::persistent::extend_ttl(env, key, None);
        crate::persistent::extend_instance_ttl(env, None);
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
        crate::persistent::extend_instance_ttl(&env, None);
        if env.storage().persistent().has(&DataKey::Issuer) {
            panic!("CRL already initialized");
        }

        issuer.require_auth();

        let now = env.ledger().timestamp();
        let empty_ids: Vec<String> = Vec::new(&env);
        let crl_info = CRLInfo {
            issuer: issuer.clone(),
            revoked_count: 0,
            crl_number: 1,
            this_update: now,
            next_update: now + DEFAULT_UPDATE_WINDOW_SECONDS,
            merkle_root: Self::build_merkle_root(&env, &empty_ids),
        };

        Self::set_persistent(&env, &DataKey::Issuer, &issuer);
        Self::set_persistent(&env, &DataKey::CertContract, &certificate_contract);
        Self::set_persistent(
            &env,
            &DataKey::RevokedCertificates,
            &Vec::<String>::new(&env),
        );
        Self::set_persistent(&env, &DataKey::Info, &crl_info);
    }

    pub fn revoke_certificate(
        env: Env,
        authorizer: Address,
        certificate_id: String,
        reason: RevocationReason,
        _serial_number: Option<String>,
    ) {
        crate::persistent::extend_instance_ttl(&env, None);
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

        let revocation_key = DataKey::Revocation(certificate_id.clone());
        if env.storage().persistent().has(&revocation_key) {
            panic!("Certificate already revoked");
        }

        let mut crl_info = Self::get_crl_info_internal(&env);
        let revocation_info = RevocationInfo {
            certificate_id: certificate_id.clone(),
            reason: reason as u32,
            issuer: issuer.clone(),
            revocation_date: env.ledger().timestamp(),
            revoked_by: authorizer.clone(),
        };

        Self::set_persistent(&env, &revocation_key, &revocation_info);

        let mut revoked_certificates = Self::get_revoked_certificate_ids(&env);
        revoked_certificates.push_back(certificate_id);
        Self::set_persistent(&env, &DataKey::RevokedCertificates, &revoked_certificates);

        crl_info.revoked_count += 1;
        Self::refresh_crl_info(&env, &mut crl_info, &revoked_certificates);
        Self::set_persistent(&env, &DataKey::Info, &crl_info);
    }

    pub fn is_revoked(env: Env, certificate_id: String) -> bool {
        crate::persistent::extend_instance_ttl(&env, None);
        let key = DataKey::Revocation(certificate_id);
        crate::persistent::extend_ttl(&env, &key, None);
        env.storage().persistent().has(&key)
    }

    pub fn get_revocation_info(env: Env, certificate_id: String) -> Option<RevocationInfo> {
        crate::persistent::extend_instance_ttl(&env, None);
        let key = DataKey::Revocation(certificate_id);
        crate::persistent::extend_ttl(&env, &key, None);
        env.storage().persistent().get(&key)
    }

    pub fn get_revoked_count(env: Env) -> u32 {
        crate::persistent::extend_instance_ttl(&env, None);
        crate::persistent::extend_ttl(&env, &DataKey::Info, None);
        Self::get_crl_info_internal(&env).revoked_count
    }

    pub fn get_crl_info(env: Env) -> CRLInfo {
        crate::persistent::extend_instance_ttl(&env, None);
        crate::persistent::extend_ttl(&env, &DataKey::Info, None);
        Self::get_crl_info_internal(&env)
    }

    pub fn get_revoked_certificates(env: Env, page: u32, limit: u32) -> Vec<RevocationInfo> {
        crate::persistent::extend_instance_ttl(&env, None);
        crate::persistent::extend_ttl(&env, &DataKey::RevokedCertificates, None);
        let revoked_certificates = Self::get_revoked_certificate_ids(&env);
        let mut page_of_revocations = Vec::new(&env);

        if limit == 0 {
            return page_of_revocations;
        }

        let start = page.saturating_mul(limit);
        let mut end = start.saturating_add(limit);
        let total = revoked_certificates.len();
        if end > total {
            end = total;
        }

        let mut index = start;
        while index < end {
            if let Some(certificate_id) = revoked_certificates.get(index) {
                if let Some(revocation_info) = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Revocation(certificate_id.clone()))
                {
                    page_of_revocations.push_back(revocation_info);
                }
            }
            index += 1;
        }

        page_of_revocations
    }

    pub fn verify_certificate(env: Env, certificate_id: String) -> (bool, u64) {
        crate::persistent::extend_instance_ttl(&env, None);
        crate::persistent::extend_ttl(&env, &DataKey::Info, None);
        let rev_key = DataKey::Revocation(certificate_id);
        crate::persistent::extend_ttl(&env, &rev_key, None);
        let crl_info = Self::get_crl_info_internal(&env);
        let is_revoked = env.storage().persistent().has(&rev_key);

        (is_revoked, crl_info.crl_number)
    }

    pub fn get_merkle_root(env: Env) -> String {
        crate::persistent::extend_instance_ttl(&env, None);
        crate::persistent::extend_ttl(&env, &DataKey::Info, None);
        Self::get_crl_info_internal(&env).merkle_root
    }

    pub fn update_crl_metadata(env: Env, next_update: Option<u64>, _issuer: Option<Address>) {
        crate::persistent::extend_instance_ttl(&env, None);
        let issuer = Self::get_issuer(&env);
        issuer.require_auth();

        let mut crl_info = Self::get_crl_info_internal(&env);
        if let Some(new_next_update) = next_update {
            crl_info.next_update = new_next_update;
        }

        let revoked_ids = Self::get_revoked_certificate_ids(&env);
        Self::refresh_crl_info(&env, &mut crl_info, &revoked_ids);
        Self::set_persistent(&env, &DataKey::Info, &crl_info);
    }

    /// Set an admin address that can authorize revocations/unrevocations
    pub fn set_admin(env: Env, admin: Address) {
        let issuer = Self::get_issuer(&env);
        issuer.require_auth();
        Self::set_instance(&env, &DataKey::Admin, &admin);
    }

    pub fn needs_update(env: Env) -> bool {
        crate::persistent::extend_instance_ttl(&env, None);
        crate::persistent::extend_ttl(&env, &DataKey::Info, None);
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

    fn get_revoked_certificate_ids(env: &Env) -> Vec<String> {
        match env
            .storage()
            .persistent()
            .get(&DataKey::RevokedCertificates)
        {
            Some(revoked_certificates) => revoked_certificates,
            None => Vec::new(env),
        }
    }

    fn refresh_crl_info(env: &Env, crl_info: &mut CRLInfo, revoked_ids: &Vec<String>) {
        crl_info.crl_number += 1;
        crl_info.this_update = env.ledger().timestamp();
        crl_info.merkle_root = Self::build_merkle_root(env, revoked_ids);
    }

    fn build_merkle_root(env: &Env, revoked_ids: &Vec<String>) -> String {
        fn sha256_bytes(env: &Env, data: &Bytes) -> BytesN<32> {
            env.crypto().sha256(data).into()
        }

        fn pair_hash(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
            let mut combined = [0u8; 64];
            combined[..32].copy_from_slice(&left.to_array());
            combined[32..].copy_from_slice(&right.to_array());
            sha256_bytes(env, &Bytes::from_slice(env, &combined))
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

        if revoked_ids.is_empty() {
            return hash_to_hex(env, &sha256_bytes(env, &Bytes::new(env)));
        }

        // Build leaf hashes from certificate IDs
        let mut layer: Vec<BytesN<32>> = Vec::new(env);
        for id in revoked_ids.iter() {
            let len = id.len() as usize;
            let mut buf = [0u8; 256];
            id.copy_into_slice(&mut buf[..len]);
            let id_bytes = Bytes::from_slice(env, &buf[..len]);
            layer.push_back(sha256_bytes(env, &id_bytes));
        }

        // Combine pairs up the tree until one root remains
        while layer.len() > 1 {
            let mut next: Vec<BytesN<32>> = Vec::new(env);
            let mut i = 0u32;
            while i < layer.len() {
                let left = layer.get_unchecked(i);
                let right = if i + 1 < layer.len() {
                    layer.get_unchecked(i + 1)
                } else {
                    left.clone() // duplicate odd leaf
                };
                next.push_back(pair_hash(env, &left, &right));
                i += 2;
            }
            layer = next;
        }

        hash_to_hex(env, &layer.get_unchecked(0))
    }
}
