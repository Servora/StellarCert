use soroban_sdk::Address;
pub fn propose_certificate(issuer: Address) { issuer.require_auth(); }
