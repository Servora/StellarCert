# Implementation: Issues #719–#722

## #720 – Multisig DTO constructors
Removed `constructor(private readonly logger: LoggingService)` from all DTOs in `multisig.controller.ts`. DTOs are plain property bags for class-transformer.

## #721 – Transaction polling
Added `waitForTransaction()` that polls RPC until SUCCESS/FAILED (default 30 attempts × 2s). All `sendTransaction` PENDING paths use it instead of same-tick `getTransaction`.

## #722 – Real results instead of mocks
- `proposeCertificate` → `getPendingRequest(requestId)` after success
- `approveRequest` / `rejectRequest` → include `final_status` from on-chain state

## #719 – Webhook secret hygiene
- Create returns plaintext `secret` **once**
- Stores `secretHash` (SHA-256)
- `findAll` / `findOne` return sanitized objects with `hasSecret: true` and **no** `secret`
- Processor still loads full entity from DB for HMAC signing

## Verify
```bash
cd backend && npx jest multisig.service.poll webhooks.secret --passWithNoTests
```
