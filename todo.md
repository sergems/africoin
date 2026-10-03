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
- [x] **Profile picture:** “They should be able to update their profile picture and start transacting.” A signed-in user can upload/change an optional private JPEG/PNG profile picture, see it in their profile and dashboard avatar, and does not have to finish KYC first.
- [x] **Withdrawal eligibility:** “when it comes to withdrawal, if KYC and all the requirements are not met, the user should not be allowed to withdraw.” Require approved KYC, accepted identity, address, and source-of-funds documents, and active/unblocked account, wallet, and risk limits. An approved KYC status without the three accepted documents does not permit withdrawal.
- [x] **2.5% withdrawal fee and Africoin ledger:** “all withdrawal with incure a 2.5% fee paid to Africoin's account, which the admin and super admin should be able to see as transaction fee.” The entered withdrawal amount is the total wallet debit; deduct the 2.5% fee from it and calculate a 97.5% payout. Record the fee in a same-currency internal Africoin ledger, visible as a transaction fee to Admin and Super Admin, only after staff records successful off-platform payout completion with an external reference; the app does not send money automatically. Rejected/cancelled requests do not collect a fee.
- [x] **Safe manual settlement:** Staff approval rechecks eligibility and places the full withdrawal amount on hold so it cannot be double-spent; staff records an external reference to complete the payout; rejection/cancellation before payout releases the hold; duplicate settlement is prevented and actions remain audited.
- [x] **Production-database safety:** Do not connect this work to or run migrations against the user’s separately operated existing production database. The approved WebDev-managed database is shared between this project’s development/Preview and any WebDev-published runtime; no publishing/deployment is included in this change. Keep schema changes additive. The app’s existing server-startup hook automatically runs checked-in Drizzle migrations, so the migration will apply to whichever database the user’s production runtime is configured to use when they later deploy; the user should review/backup that database under their deployment process first.

### Verification evidence



### Verification evidence

- TypeScript check passed.
- Vitest passed: 19 files, 84 tests.
- Production build passed; it reports non-blocking analytics-placeholder and large-chunk warnings.
- Preview health and route-manifest endpoints returned HTTP 200; the manifest matches all 18 declared page routes.
- The separately operated production database was not configured, connected to, or migrated in this task.
