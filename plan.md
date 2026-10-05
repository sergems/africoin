# Africoin — KYC access, withdrawals, fees, and profile photos

## Approved product decisions

- New users may register, trade, and initiate/receive deposits while KYC or documents are incomplete. Existing non-KYC safeguards (account/risk restrictions, wallet state, available balance, daily limits, provider confirmation) remain in force.
- Super Admin KYC review remains available for the reviewer’s own account and other users. The existing review flow is already audit logged. An approved KYC status alone does **not** qualify an account for withdrawal.
- Withdrawal eligibility requires approved KYC, accepted identity, proof-of-address, and source-of-funds documents, plus active/unblocked account and risk controls.
- The amount entered for a withdrawal is the **total wallet debit**. The 2.5% Africoin fee is deducted from it; the external payout amount is 97.5% of the total, rounded to the currency’s two decimal places.
- Preserve the current absence of automatic payouts. Add a manual, audited completion step: an authorized staff member records an external payout reference after the off-platform payout is actually completed. Only then is the withdrawal finalized and its fee credited to Africoin’s internal fee ledger in the withdrawal currency. No payment is initiated by the application.
- Enable the approved managed WebDev database/server for this WebDev project. The platform shares that database between development/Preview and a WebDev-published runtime. Use it for this project’s Preview work, but do not connect to, migrate, or modify the user’s separately operated existing production database. Keep changes additive; the app’s existing startup hook applies checked-in Drizzle migrations to whichever database each runtime is configured to use. Do not publish or deploy this task; when the user later deploys to production, they should review and back up that database first.
- Store new private profile pictures in a persistent per-user server directory, retain read compatibility for older Forge-backed avatar keys, and serve local images only to the authenticated owner. KYC documents remain Forge-backed and are not migrated by this change.

## Implementation approach

### Account access and eligibility

- Remove KYC-only denial from the server trading eligibility function and all client trading controls. Keep wallet status, risk limits, market status, available-balance, and existing order limits intact.
- Remove KYC-only denial from deposit creation and from provider-success settlement. Continue to require active risk controls before a confirmed payment can credit a wallet; unresolved provider exceptions stay in their current review flow.
- Centralize withdrawal eligibility so both creating a request and approving/settling one check the latest KYC case, latest document per required type, account/risk status, and wallet status. A newer pending/rejected replacement document supersedes an older accepted copy.
- Preserve the existing `adminUsers.reviewKyc` permission path, including review of the Super Admin’s own record; verify it in tests rather than adding a self-review prohibition.

### Withdrawal hold, payout record, and fee ledger

- Add additive schema fields for the calculated fee and net payout on a withdrawal request, plus an Africoin fee-ledger table keyed uniquely to the settled withdrawal. No table is dropped; existing withdrawals receive a one-time backfill to initialize the new payout amount, without retroactively charging fees.
- At request time, calculate the fee using integer minor-unit rounding, verify eligibility and sufficient available funds, and show the estimate. Do not collect a fee or credit the treasury at request time.
- At approval, re-check eligibility and balance atomically, then move the full gross amount from available balance to pending balance to prevent double-spending while staff completes the off-platform transfer. On rejection/cancellation before payout, release that hold; no fee is collected.
- Add a staff-only manual completion action for an approved withdrawal. Require an external transfer reference; atomically consume the held gross amount, record a user withdrawal debit for the 97.5% payout and a separate 2.5% fee debit, create one Africoin ledger credit in the same currency, update reconciliation/audit/notifications, and prevent duplicate settlement. Recheck withdrawal eligibility before completion. Do not create a network payment call.
- Expose collected fee transactions and totals per CDF/USD in the Africoin operations interface to both Admin and Super Admin. Pending estimates remain distinguishable from collected fees.

### Profile pictures and user guidance

- Add an optional profile image key to `client_profiles` and an authenticated upload mutation. Accept only JPEG/PNG image bytes, enforce a 5 MiB limit server-side, use a generated opaque file name under a private per-user directory, and write an audit event. Serve local files through an owner-authenticated route; never expose filesystem paths or server credentials. Keep older Forge-backed avatar keys readable when Forge is configured.
- Add an upload/update control and preview in Settings and use the user’s image in the dashboard avatar with the existing initials fallback. This is an optional profile field, not a KYC prerequisite.
- Update French UI copy in Documents, Wallets, Market, Home, and Settings so users understand they can register/deposit/trade before KYC, while withdrawals require approved KYC plus all three accepted documents. Display the 2.5% fee and net payout before submitting a withdrawal.

## Design direction

- **Design movement:** restrained Pan-African fintech, continuing the existing Africoin institutional dashboard rather than introducing a new visual system.
- **Core principles:** make money movement legible; make verification status actionable; keep privileged operations auditable; use progressive disclosure instead of alarm-heavy blocks.
- **Color philosophy:** preserve deep navy for trust, teal for positive/verified states, and warm gold for Africoin identity and fee emphasis; reserve amber/red for pending or blocked states.
- **Layout paradigm:** retain the current left-anchored dashboard/sidebar and card-based workspace; add fee summaries beside the withdrawal queue and keep the profile photo control in the account-settings flow.
- **Signature elements:** rounded navy decision panel, teal verification/status cues, and gold monetary emphasis for the fee/net calculation.
- **Interaction and animation:** immediate local fee preview as amount changes; disabled actions explain unmet withdrawal requirements; use existing concise toast feedback and restrained transitions, with no motion on financial confirmation beyond clear state changes.
- **Typography:** keep the existing sans-serif dashboard hierarchy—compact uppercase teal section labels, strong navy page titles, readable slate body copy, and tabular/monospaced numerals for amounts where the current components support it.
- **Brand essence:** a clear, region-aware digital finance workspace for Africoin customers; **confident, transparent, grounded**. Voice stays direct and helpful: “Your funds remain available while your documents are reviewed.” / “Withdrawals open after your KYC file and required documents are approved.”
- **Wordmark and signature color:** retain the existing AFRICOIN/TRADING GROUP wordmark treatment and signature teal `#087f78`, with navy `#0a2233` and gold `#e6b93f` as supporting identity colors.

## Project structure

- `drizzle/schema.ts` and a generated additive migration: profile image key, withdrawal fee/payout fields, and Africoin fee ledger.
- `server/tradingGuards.ts`, `server/kelpay.ts`, `server/routers.ts`, and `server/withdrawals.ts`: centralized eligibility changes, deposit/trade access, withdrawal lifecycle, fee accounting, and authorized API procedures.
- `server/profilePictureStore.ts`, `server/_core/profilePictureRoute.ts`, and `deploy/docker-compose.yml`: local private avatar files, authenticated retrieval, and a persistent host-directory mount. This follow-up adds no database migration; avatar files require separate backups from MySQL.
- `client/src/pages/Wallets.tsx`, `client/src/pages/Admin.tsx`, `client/src/pages/Documents.tsx`, `client/src/pages/Market.tsx`, `client/src/pages/Home.tsx`, `client/src/pages/Settings.tsx`, and `client/src/components/DashboardLayout.tsx`: customer guidance, fee preview, staff completion/reporting, and avatar controls.
- Focused unit/contract tests alongside the existing server tests; existing application structure and UI primitives remain in use.

## Existing production database boundary

The approved WebDev-managed database is shared between development/Preview and any WebDev-published runtime; the WebDev platform does not provide a separate managed staging database. This work may migrate that project-managed database when Preview starts. Do not request or set the separately operated production `DATABASE_URL`, connect this Sandbox to it, or run migrations against it, and do not publish/deploy from this task. The existing server startup calls `runDatabaseMigrations()` automatically: after the user deploys this code, that existing hook will apply checked-in migrations to whichever database the production runtime is configured to use. The new Drizzle migration is additive (new table, nullable/zero-default columns, and a backfill of existing payout amounts); it does not drop tables or erase existing user data. The user should review/backup their existing production database under their own release process before deploying.

The local-avatar storage follow-up adds no schema migration and does not change KYC document storage. Production deployment must create a persistent host directory writable by the container’s `node` user and back up that directory separately from the database.


## Preview no-KYC flow QA follow-up

- Renamed the platform-reserved `app_session_id` cookie to `africoin_user_session`. Cookie tests verify `SameSite=None; Secure` for public HTTPS Preview requests despite the internal HTTP listener, and plain local HTTP retains `SameSite=Lax; Secure=false`.
- Registered a synthetic `@example.test` user in Preview and confirmed its authenticated session persists across `/dashboard`, `/documents`, `/wallets`, and `/market`. The Documents page showed no uploaded KYC documents, and Activity showed KYC `not_started`; no KYC documents or funds were added.
- The deposit form was available without KYC. The Preview request stopped with “Le service de dépôt Africoin n’est pas configuré” because no `KECCEL_*` credentials are configured. The server checks provider configuration before writing a request or contacting the provider; no deposit was created and no payment was sent.
- The EUR/USD spot trade ticket was available without a KYC denial, but was blocked because the synthetic account’s USD balance is zero. Activity subsequently showed 0 orders and 0 transactions; no order or fake wallet credit was created. Existing API and unit tests verify the KYC-independent server guard while retaining risk, market, wallet, notional, and available-balance safeguards.
- Final verification: TypeScript check passed; Vitest passed 20 files/89 tests; production build passed with non-blocking analytics-placeholder and large-chunk warnings; Preview health and the 18-route manifest returned HTTP 200. The synthetic account remains in the WebDev-managed database with zero balance and no KYC documents.
