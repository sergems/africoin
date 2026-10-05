# Africoin implementation tracking

## Completed in this change

- Removed Manus OAuth entry points, callback registration, client buttons, SDK API calls, and Axios support. Authentication now uses the existing Africoin email/password registration and local JWT session flow only.
- Preserved only `serge@mediabeyondvision.com` in the managed database as the `super_admin` account. Non-Serge user records and user-linked records were purged and verified at zero remaining rows in the checked tables.
- Added user KYC document upload from the Documents screen. Accepted formats are PDF, JPG, and PNG, with a 10 MB limit. Documents use private storage references and signed review URLs.
- Added compliance document review with accept/reject actions, reviewer notes, notifications, and audit logging.
- Added administrator funding approval controls. Approved deposits credit the user wallet and create a completed wallet transaction; rejected requests do not credit funds.
- Added atomic pending-order reservations against `availableBalance`, moving reserved notional into `pendingBalance`. Added cancellation to release the reserved amount and record the action.
- Added an explicit 404 response for the retired `/api/oauth/callback` endpoint.

## Validation

- `pnpm check` passed.
- `pnpm build` passed.
- `pnpm test` passed: 12 test files and 44 tests.
- `git diff --check` passed.
- Preview routes `/`, `/connexion`, `/inscription`, `/documents`, and `/compliance` returned HTTP 200.
- Retired OAuth callback returned HTTP 404.

## Follow-up considerations

- Real payment and brokerage providers remain in the existing pending-activation mode. Funding approval is administrative and should be connected to a confirmed payment/reconciliation provider before production use.
- Pending order reservations remain held until the order is cancelled or a future execution/settlement workflow releases or consumes them.
- The admin document review buttons currently use standard review notes; a richer note dialog can be added if individualized rejection reasons are needed.


## Current requested outcomes — KYC access, withdrawals, fees, and profile picture

- [x] **Super Admin KYC review, including self-review:** “The super admin must be able to KYC and approve himself and other users.” Preserve the existing audited Super Admin KYC review path for the reviewer’s own account and other users.
- [x] **Registration, deposits, and trading before KYC completion:** “new users should be able to register and transact, deposit, trade even if kyc and other documents are still outstanding.” KYC/document incompleteness alone must not block registration, trading, deposit requests, or crediting a provider-confirmed deposit; existing account/risk limits, wallet status, balance, and payment-provider safeguards remain in force.
- [x] **Profile picture:** “They should be able to update their profile picture and start transacting.” A signed-in user can upload/change an optional private JPEG/PNG profile picture, see it in their profile and dashboard avatar, and does not have to finish KYC first. New photos are stored in a persistent per-user server folder and served only to the authenticated owner; old Forge-backed avatar keys remain readable when configured.
- [x] **Withdrawal eligibility:** “when it comes to withdrawal, if KYC and all the requirements are not met, the user should not be allowed to withdraw.” Require approved KYC, accepted identity, address, and source-of-funds documents, and active/unblocked account, wallet, and risk limits. An approved KYC status without the three accepted documents does not permit withdrawal.
- [x] **2.5% withdrawal fee and Africoin ledger:** “all withdrawal with incure a 2.5% fee paid to Africoin's account, which the admin and super admin should be able to see as transaction fee.” The entered withdrawal amount is the total wallet debit; deduct the 2.5% fee from it and calculate a 97.5% payout. Record the fee in a same-currency internal Africoin ledger, visible as a transaction fee to Admin and Super Admin, only after staff records successful off-platform payout completion with an external reference; the app does not send money automatically. Rejected/cancelled requests do not collect a fee.
- [x] **Safe manual settlement:** Staff approval rechecks eligibility and places the full withdrawal amount on hold so it cannot be double-spent; staff records an external reference to complete the payout; rejection/cancellation before payout releases the hold; duplicate settlement is prevented and actions remain audited.
- [x] **Production-database safety:** Do not connect this work to or run migrations against the user’s separately operated existing production database. The approved WebDev-managed database is shared between this project’s development/Preview and any WebDev-published runtime; no publishing/deployment is included in this change. Keep schema changes additive. The app’s existing server-startup hook automatically runs checked-in Drizzle migrations, so the migration will apply to whichever database the user’s production runtime is configured to use when they later deploy; the user should review/backup that database under their deployment process first.

### Verification evidence

- TypeScript check passed.
- Vitest passed: 20 files, 89 tests.
- Production build passed; it reports non-blocking analytics-placeholder and large-chunk warnings.
- Preview health and route-manifest endpoints returned HTTP 200; the manifest matches all 18 declared page routes.
- The separately operated production database was not configured, connected to, or migrated in this task.


## Requested Preview no-KYC flow QA

- [x] **Registration and authenticated Preview session:** A new synthetic test user can register without KYC documents, sign in over the public HTTPS Preview origin, and remain authenticated on the protected dashboard; the account’s KYC state stays not started/pending. **Observed:** registration succeeded; the app-owned cookie rename and HTTPS flags fixed persistence across dashboard, documents, wallet, and market routes. The Documents page showed no uploaded KYC documents.
- [x] **Pre-KYC deposit boundary:** With KYC incomplete, the deposit path does not return a KYC denial. Since Preview has no `KECCEL_*` payment secrets, it must stop at the provider-configuration precondition before writing a payment request or contacting an external payment provider; do not send or simulate a payment. **Observed:** the deposit form was available and the API returned “Le service de dépôt Africoin n’est pas configuré”; no request was created and no payment was sent. A successful provider-backed deposit remains untestable until the Preview provider is configured.
- [x] **Pre-KYC trade boundary:** With KYC incomplete, the trade path does not return a KYC denial and retains active-risk, market, wallet, notional, position, and available-balance safeguards. Use no fake wallet credit; an empty test wallet may block execution for insufficient funds. **Observed:** the EUR/USD trade ticket opened without a KYC denial; it was disabled for zero available USD. Activity showed KYC `not_started`, 0 orders, and 0 transactions after the attempt.
- A synthetic Preview test account remains in the WebDev-managed database with zero balance and no KYC documents. No live payment or broker action was performed.
- The cookie regression tests pass for the platform-reserved-name avoidance, public HTTPS Preview, forwarded HTTPS, and local HTTP cases.

## Profile-picture local-storage follow-up

- [x] New profile-picture uploads no longer require Forge storage credentials; save validated JPEG/PNG files with restrictive file/directory permissions beneath a configurable server directory, preserve legacy Forge avatar reads, and return only an owner-authenticated same-origin image URL.
- [x] Bind profile-picture storage to `/var/lib/africoin/profile-pictures` on the host by default; document UID/GID 1000 ownership and separate file backups.
- [x] Mark deployment/backup/restore scripts executable in Git so the documented `./deploy.sh` and helper invocations work after checkout.

### Verification evidence

- `pnpm check` passed.
- Vitest passed: 21 test files, 93 tests (including four local avatar-store tests).
- `pnpm build` passed with only the existing analytics-placeholder and large-chunk warnings.
- `git diff --check` passed. Compose YAML parsed successfully and its avatar bind mount was asserted with PyYAML; Docker is not installed in the Sandbox, so `docker compose config -q` could not be run here.

## KYC document Linode-local storage follow-up

- [x] New KYC uploads validate PDF/JPEG/PNG signatures and a 10 MiB limit, store under opaque per-user/per-case keys in a persistent server folder with restrictive permissions, and do not require Forge credentials.
- [x] Serve local documents only to their owner or a role with KYC-review permission; do not expose filesystem paths or Forge signed URLs to clients. Preserve a bounded, MIME-checked server-side read path for legacy records until they are migrated.
- [x] Provide a dry-run/apply utility to copy legacy files and update database keys only after each successful write; record a private rollback manifest, preserve old copies, and add a guarded rollback that refuses to strand newer local uploads. No Drizzle schema migration is added.
- [x] Add the Linode KYC host-folder mount, environment setting, per-folder backup/restore steps, and PowerShell-to-SSH deployment instructions.

### Verification evidence

- `pnpm check` passed.
- Vitest passed: 22 test files, 99 tests (including six KYC local-store and authorization tests).
- `pnpm build` passed and compiled `dist/migrateKycDocumentsToLocal.js`; existing analytics-placeholder and large-chunk warnings remain.
- Compose YAML parsed and the KYC persistent bind mount was asserted with PyYAML; Docker CLI is unavailable in the Sandbox, so `docker compose config -q` was not run here.
- `git diff --check` passed. No Linode server was accessed and the one-time legacy-file migration was not executed.

## Profile-picture storage permission repair

- [x] After a fast-forward Git pull, the deploy helper reloads the updated script, prepares both persistent bind-mount roots for runtime UID/GID 1000, and verifies write access as the app user before proceeding.
- [x] Profile upload errors distinguish storage permission/read-only failures from exhausted disk/quota, while logs record only the error code.
- [x] Document a one-time, non-destructive repair for existing profile/KYC folders and keep the Linode runbook aligned.

### Verification evidence

- `pnpm check`, `pnpm test` (22 files, 100 tests), and `pnpm build` passed; existing analytics-placeholder and large-chunk warnings remain.
- `bash -n deploy/scripts/deploy.sh` and `git diff --check` passed. Compose YAML parsed and both persistent upload mounts were asserted with PyYAML; the Docker CLI is unavailable in the Sandbox.
- No Linode server was accessed or changed.
