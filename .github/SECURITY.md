# Security Policy

## Scope

This policy covers the StellarCert repository, including:

- **Backend API** – JWT authentication, webhook signing, issuer key management
- **Frontend** – session handling, certificate verification UI
- **Stellar / Soroban smart contracts** – on-chain certificate issuance, revocation, and multi-signature logic

Out of scope: third-party dependencies (report those upstream), Stellar network infrastructure, and test/demo deployments that hold no real keys or certificates.

## Supported versions

| Component              | Supported                            |
| ---------------------- | ------------------------------------ |
| `main` branch (latest) | ✅                                   |
| Older branches / tags  | ❌ — please upgrade before reporting |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.** A public issue exposes the flaw before a fix is available.

Instead, send a report to:

> **security@servora.dev**

Include as much of the following as you can:

- A description of the vulnerability and its potential impact
- Affected component(s) and version/commit
- Step-by-step reproduction instructions or a proof-of-concept
- Any suggested mitigations

You may encrypt the report with our PGP key if you prefer — post a comment on the [SECURITY advisory](../../security/advisories) asking us to share the key, and we will respond via that thread.

Alternatively, you can open a [private GitHub Security Advisory](../../security/advisories/new) directly in this repository. GitHub keeps it confidential until we publish a fix.

## Response timeline

| Milestone                                   | Target                                          |
| ------------------------------------------- | ----------------------------------------------- |
| Acknowledge receipt                         | 2 business days                                 |
| Initial severity assessment                 | 5 business days                                 |
| Status update (fix in progress or declined) | 10 business days                                |
| Patch and coordinated disclosure            | Depends on severity; we aim for 90 days maximum |

We will keep you informed at each stage and will not publish a fix without notifying you first.

## Disclosure policy

We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure). Once a fix is released we will:

1. Publish a GitHub Security Advisory crediting the reporter (unless you prefer to stay anonymous).
2. Tag a new release and update the changelog with a security notice.
3. Post a brief public disclosure describing the issue and the fix.

## Priority issues for this project

Given that StellarCert manages Stellar secret keys, signs JWTs and webhook payloads, and records certificates on-chain, we treat the following as **critical** and will respond as fast as possible:

- Exposure or extraction of Stellar secret keys or JWT signing secrets
- Bypass of issuer authorization (minting certificates without permission)
- Forgery or undetected revocation of on-chain certificates
- Authentication or authorization bypasses in the backend API
- Supply-chain attacks against the smart contract build or deployment pipeline

## Safe harbor

We will not pursue legal action against researchers who discover and report vulnerabilities in good faith under this policy, provided they do not exploit the vulnerability beyond what is necessary to demonstrate it and do not access, modify, or delete data belonging to others.
