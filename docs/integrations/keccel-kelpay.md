# Keccel KelPay integration

## Source contract

Implementation follows the user-provided `KelpayPayinAPIv1.2.pdf` (Keccel Payment Gateway: KelPay, version 1.2, four pages) for mobile money, and `KelpayAPICard(2).pdf` for the documented hosted-card request shape. The mobile-money guide covers DRC operators Orange Money, M-PESA, Airtel Money and AfriMoney. The card guide is recorded below, but card deposits are not enabled because it does not provide a secure result-verification contract.

### Initiate mobile-money pay-in

- `POST https://pay.keccel.com/kelpay/v1/payment.asp`
- Headers: `Authorization: Bearer <merchant token>`, `Content-Type: application/json`
- JSON body (all required): `merchantcode`, `mobilenumber`, unique `reference`, `amount`, `currency` (`USD` or `CDF`), `description`, `callbackurl`.
- Immediate response `code=0` means the request was accepted, not that funds were received. `code=1` means it was not accepted. The final result arrives asynchronously at the callback.

### Verify transaction result

- `POST https://pay.keccel.com/kelpay/v1/checktransaction.asp`
- Same Bearer token and JSON content type.
- JSON body: `merchantcode`, `transactionid` returned by the initial request.
- The guide describes final status values `SUCCESS` and `FAILED`, with `code=0` for success and `code=1` for failure. The application independently verifies merchant code, reference, transaction ID, amount and currency before settling a deposit.
- The guide recommends waiting a few seconds before checks and caps checks at three per transaction ID. The application enforces a five-second spacing and a maximum of three checks.

### Callback

The initial pay-in request includes a public HTTPS callback URL. Keccel sends the transaction result asynchronously; the merchant callback should return a simple `OK`. The guide does not specify a signed webhook/authentication scheme, so callback fields are treated only as a trigger: the application confirms them through `checktransaction.asp` before changing a wallet balance.

### Credit-card hosted checkout (documented, not enabled)

- `POST https://api.keccel.net/cardpay` with `Authorization: Bearer <merchant token>` and JSON content type.
- Required body fields in the guide: `merchantcode`, `reference`, `amount`, `currency`, `description`, `callbackurl`, and `returnurl`.
- An immediate `code=0` response includes a `checkouturl` and `transactionid`; `code=1` means the request was not accepted. Any future card flow must redirect to Keccel's hosted checkout and must never collect or store card numbers or security codes in Africoin.
- The browser `returnurl` is only a navigation destination, not proof of payment. The documented callback result lists only `code`, `description`, `reference`, and `transactionid`.
- The card guide does not specify a callback signature/HMAC, merchant/amount/currency fields in the result, or a card transaction-status endpoint. The mobile-money `checktransaction.asp` endpoint is not assumed to support card transactions without Keccel confirmation. Therefore card callbacks cannot safely authorize wallet credits, and card deposits remain disabled until Keccel documents a signed callback or authenticated verification endpoint that confirms merchant, reference, transaction ID, amount, currency, and final status.

## Application behavior

- `KECCEL_API_TOKEN`, `KECCEL_MERCHANT_CODE` and `KECCEL_CALLBACK_URL` are supplied via protected WebDev secrets. The callback URL must be the exact public HTTPS endpoint `/api/payments/kelpay/callback` for the target environment.
- Pay-in requests are authenticated, KYC-approved, subject to the account risk status and daily deposit limit, and recorded with an idempotent application reference before calling Keccel.
- A wallet is credited once, transactionally, only after a matching successful status check and a fresh, locked KYC/risk eligibility check. If provider success arrives after the account becomes ineligible, the confirmed funds are held for manual compliance review and are not credited.
- Deposits for one user are serialized while the daily limit is recalculated and the request is recorded. Idempotency keys are unique by user and operation.
- Callback transaction IDs remain untrusted candidates until `checktransaction.asp` confirms them. Early callbacks wait for the minimum status-check interval and trigger a server-side verification; checks are atomically spaced and capped at three.
- Database migrations run from the committed migration history after the HTTP listener binds; `/api/health` remains not-ready until migration succeeds.
- The raw subscriber phone is sent to Keccel but is not stored in the application database or audit log.
- Users may submit withdrawal requests for admin/super-admin review. Approval records `approved_pending_payout`; it does not reserve or change wallet balances, settle reconciliation, or send a payout. Actual withdrawal/payout initiation remains disabled until Keccel supplies its separate payout API contract. The supplied PDF contains a status-check endpoint but no payout-initiation request schema; the status-check endpoint is not used to initiate payouts.

## Not yet verified

No live provider call was made during implementation. Credentials, merchant onboarding, callback reachability from Keccel, operator routing behavior, provider sandbox availability, settlement timing/fees, the card verification contract, and the payout contract remain to be confirmed with Keccel.
