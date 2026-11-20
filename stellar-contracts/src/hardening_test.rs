#![cfg(test)]
//! Regression tests for #1363 (CRL mirror binding), #1364 (`build` metadata),
//! #1365 (circuit breaker) and #1366 (`total_cost` is a score, not a fee).

extern crate std;

use super::*;
use crate::crl::CRLContractClient;
use soroban_sdk::{testutils::Address as _, vec, Address, Env, String};

struct Ctx {
    env: Env,
    admin: Address,
    issuer: Address,
    owner: Address,
    cert_id: Address,
}

impl Ctx {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let issuer = Address::generate(&env);
        let owner = Address::generate(&env);
        let cert_id = env.register(CertificateContract, ());
        let client = CertificateContractClient::new(&env, &cert_id);
        client.initialize(&admin);
        client.add_issuer(&issuer);
        Ctx {
            env,
            admin,
            issuer,
            owner,
            cert_id,
        }
    }

    fn client(&self) -> CertificateContractClient<'_> {
        CertificateContractClient::new(&self.env, &self.cert_id)
    }

    fn s(&self, v: &str) -> String {
        String::from_str(&self.env, v)
    }

    fn issue(&self, id: &str) -> String {
        let id = self.s(id);
        self.client().issue_certificate(
            &id,
            &self.issuer,
            &self.owner,
            &self.s("ipfs://QmTest"),
            &None,
        );
        id
    }

    /// Register a CRL owned by `issuer` and wire it into the certificate contract.
    fn with_crl(&self) -> Address {
        let crl_id = self.env.register(CRLContract, ());
        CRLContractClient::new(&self.env, &crl_id).initialize(&self.issuer, &self.cert_id);
        self.client().set_crl_contract(&crl_id);
        crl_id
    }
}

// ─── #1365 circuit breaker ────────────────────────────────────────────────────

#[test]
fn contract_starts_unpaused() {
    let ctx = Ctx::new();
    assert!(!ctx.client().is_paused());
}

#[test]
fn pause_requires_admin_authorization() {
    let ctx = Ctx::new();
    ctx.client().pause();
    let auths = ctx.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, ctx.admin);
    assert!(ctx.client().is_paused());
}

#[test]
fn pause_without_admin_auth_fails() {
    let ctx = Ctx::new();
    // Drop the blanket auth mock: nobody has signed for the admin.
    ctx.env.set_auths(&[]);
    assert!(ctx.client().try_pause().is_err());
    assert!(!ctx.client().is_paused());
}

#[test]
fn pause_halts_state_mutating_entry_points() {
    let ctx = Ctx::new();
    let client = ctx.client();
    let id = ctx.issue("cert-1");
    client.pause();

    assert!(client
        .try_issue_certificate(
            &ctx.s("cert-2"),
            &ctx.issuer,
            &ctx.owner,
            &ctx.s("ipfs://x"),
            &None
        )
        .is_err());
    assert!(client.try_revoke_certificate(&id, &ctx.s("x")).is_err());
    assert!(client.try_suspend_certificate(&id, &ctx.s("x")).is_err());
    assert!(client.try_freeze_certificate(&id, &ctx.s("x")).is_err());
    assert!(client
        .try_update_certificate_metadata(&id, &ctx.s("ipfs://y"))
        .is_err());
    assert!(client
        .try_reissue_certificate(
            &id,
            &ctx.s("cert-1b"),
            &ctx.issuer,
            &None,
            &ctx.s("ipfs://y"),
            &None,
            &None
        )
        .is_err());
    assert!(client
        .try_initiate_transfer(
            &ctx.s("t-1"),
            &id,
            &ctx.owner,
            &Address::generate(&ctx.env),
            &false,
            &0,
            &None
        )
        .is_err());
    assert!(client
        .try_propose_certificate(&ctx.s("r-1"), &ctx.issuer, &ctx.owner, &ctx.s("m"), &1)
        .is_err());

    // Nothing changed while paused.
    assert_eq!(
        client.get_certificate(&id).unwrap().status,
        CertificateStatus::Active
    );
    assert!(!client.certificate_exists(&ctx.s("cert-2")));
}

#[test]
fn governance_and_reads_still_work_while_paused() {
    let ctx = Ctx::new();
    let client = ctx.client();
    let id = ctx.issue("cert-1");
    client.pause();

    // Admin can still remediate.
    let other = Address::generate(&ctx.env);
    client.add_issuer(&other);
    client.remove_issuer(&ctx.issuer);
    assert!(client.is_issuer(&other));
    assert!(!client.is_issuer(&ctx.issuer));

    // Reads are unaffected.
    assert!(client.is_valid(&id));
    assert!(client.get_certificate(&id).is_some());
    assert_eq!(
        client
            .batch_verify_certificates(&vec![&ctx.env, id])
            .successful,
        1
    );
}

#[test]
fn unpause_restores_normal_operation() {
    let ctx = Ctx::new();
    let client = ctx.client();
    client.pause();
    client.unpause();
    assert!(!client.is_paused());
    let id = ctx.issue("cert-after-unpause");
    assert!(client.is_valid(&id));
}

// ─── #1364 build metadata ─────────────────────────────────────────────────────

#[test]
fn reissue_stores_build_metadata() {
    let ctx = Ctx::new();
    let client = ctx.client();
    let old = ctx.issue("cert-v1");
    let new = ctx.s("cert-v2");
    client.reissue_certificate(
        &old,
        &new,
        &ctx.issuer,
        &None,
        &ctx.s("ipfs://v2"),
        &None,
        &Some(ctx.s("rc.1")),
    );
    let cert = client.get_certificate(&new).unwrap();
    assert_eq!(cert.version.build, Some(ctx.s("rc.1")));
    assert_eq!(cert.version.minor, 1);
}

#[test]
fn reissue_rejects_overlong_build_metadata() {
    let ctx = Ctx::new();
    let client = ctx.client();
    let old = ctx.issue("cert-v1");
    let too_long = ctx.s(&"x".repeat(CertificateContract::MAX_BUILD_METADATA_LEN as usize + 1));
    assert!(client
        .try_reissue_certificate(
            &old,
            &ctx.s("cert-v2"),
            &ctx.issuer,
            &None,
            &ctx.s("ipfs://v2"),
            &None,
            &Some(too_long),
        )
        .is_err());
    // The original was not revoked by the failed reissue.
    assert!(client.is_valid(&old));
}

// ─── #1366 total_cost is an abstract score ────────────────────────────────────

#[test]
fn batch_verify_total_cost_is_the_documented_score() {
    let ctx = Ctx::new();
    let a = ctx.issue("a");
    let b = ctx.issue("b");
    let report = ctx
        .client()
        .batch_verify_certificates(&vec![&ctx.env, a, b, ctx.s("missing")]);
    assert_eq!(
        report.total_cost,
        CertificateContract::BATCH_VERIFY_BASE_SCORE
            + 3 * CertificateContract::BATCH_VERIFY_SCORE_PER_ID
    );
    assert_eq!(report.total_cost, 250);
}

// ─── #1363 mirrored revocation binding ────────────────────────────────────────

#[test]
#[should_panic(expected = "Refusing to mirror a revocation not recorded")]
fn mirror_helper_refuses_a_certificate_that_is_not_revoked() {
    let ctx = Ctx::new();
    ctx.with_crl();
    let id = ctx.issue("cert-live");
    ctx.env.as_contract(&ctx.cert_id, || {
        CertificateContract::mirror_revocation_to_crl(&ctx.env, &id);
    });
}

#[test]
fn mirrored_revocation_is_confirmed_against_the_certificate_contract() {
    let ctx = Ctx::new();
    let crl = CRLContractClient::new(&ctx.env, &ctx.with_crl());
    let id = ctx.issue("cert-revoked");
    ctx.client()
        .revoke_certificate(&id, &ctx.s("Key Compromise"));

    assert!(crl.is_revoked(&id));
    assert!(crl.is_revocation_confirmed(&id));
    let info = crl.get_revocation_info(&id).unwrap();
    assert_eq!(info.reason, RevocationReason::KeyCompromise as u32);
    assert_eq!(info.revoked_by, ctx.issuer);
}

#[test]
fn reissue_mirror_is_confirmed_against_the_certificate_contract() {
    let ctx = Ctx::new();
    let crl = CRLContractClient::new(&ctx.env, &ctx.with_crl());
    let old = ctx.issue("cert-v1");
    ctx.client().reissue_certificate(
        &old,
        &ctx.s("cert-v2"),
        &ctx.issuer,
        &None,
        &ctx.s("ipfs://v2"),
        &None,
        &None,
    );
    assert!(crl.is_revocation_confirmed(&old));
    assert_eq!(
        crl.get_revocation_info(&old).unwrap().reason,
        RevocationReason::Superseded as u32
    );
}

#[test]
fn crl_entry_diverging_from_the_certificate_contract_is_not_confirmed() {
    let ctx = Ctx::new();
    let crl = CRLContractClient::new(&ctx.env, &ctx.with_crl());
    let id = ctx.issue("cert-crl-only");

    // Revoked directly in the CRL; still Active in the source of truth.
    crl.revoke_certificate(&ctx.issuer, &id, &RevocationReason::KeyCompromise, &None);
    assert!(crl.is_revoked(&id));
    assert!(ctx.client().is_valid(&id));
    assert!(!crl.is_revocation_confirmed(&id));
}

#[test]
fn certificate_not_on_the_crl_is_not_confirmed() {
    let ctx = Ctx::new();
    let crl = CRLContractClient::new(&ctx.env, &ctx.with_crl());
    let id = ctx.issue("cert-clean");
    assert!(!crl.is_revocation_confirmed(&id));
}
