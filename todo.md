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
