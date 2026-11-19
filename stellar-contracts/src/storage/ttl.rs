use soroban_sdk::{Env, IntoVal, Val};

/// Default TTL: ~30 days at 5s per ledger = 518_400 ledgers.
pub const DEFAULT_TTL: u32 = 518_400;

/// Threshold below which TTL is re-extended on read: ~7 days = 120_960 ledgers.
pub const TTL_RENEWAL_THRESHOLD: u32 = 120_960;

/// Extend TTL for a given persistent storage key (called on writes).
pub fn extend_ttl<K>(env: &Env, key: &K, ttl: Option<u32>)
where
    K: IntoVal<Env, Val>,
{
    let ttl_duration = ttl.unwrap_or(DEFAULT_TTL).min(env.storage().max_ttl());
    env.storage()
        .persistent()
        .extend_ttl(key, ttl_duration, ttl_duration);
}

/// Bump TTL on read when remaining TTL falls below the renewal threshold.
pub fn bump_ttl_on_get<K>(env: &Env, key: &K)
where
    K: IntoVal<Env, Val>,
{
    let ttl_duration = DEFAULT_TTL.min(env.storage().max_ttl());
    let renewal_threshold = TTL_RENEWAL_THRESHOLD.min(ttl_duration);
    env.storage()
        .persistent()
        .extend_ttl(key, renewal_threshold, ttl_duration);
}

/// Extend TTL for the current contract instance and code.
pub fn extend_instance_ttl(env: &Env, ttl: Option<u32>) {
    let ttl_duration = ttl.unwrap_or(DEFAULT_TTL).min(env.storage().max_ttl());
    env.storage()
        .instance()
        .extend_ttl(ttl_duration, ttl_duration);
}
