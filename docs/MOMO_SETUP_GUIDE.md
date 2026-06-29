# MTN MoMo (Mobile Money) API Setup Guide

This is for whoever sets up real MTN MoMo payments for IKINAMBA / New Class Car Wash.
You already have a developer account at `developers.mtn.com`. This walks through getting
working sandbox credentials and plugging them into the app.

**Heads up on exact button labels:** MTN's developer portal has been redesigned more than
once over the years, and the underlying API itself has stayed stable even when the
website around it changed. The instructions below describe what you're looking for (a
product subscription, a key, an API user, an API key) — if a button or menu on your
screen is named slightly differently than described here, look for the option that
matches the *purpose*, not the exact wording.

## 1. Subscribe to the Collections product

"Collections" is the MoMo product for *receiving* money from a customer — what this app
needs (the customer pays the business). There's a separate "Disbursements" product for
*sending* money out, which this app doesn't use.

1. Log in at `developers.mtn.com`.
2. Open the **Payments** category (`developers.mtn.com/categories/payment`) and find
   **Collections** (sometimes called "Collection Widget" or just "MoMo Collections").
3. Subscribe to it — usually a "Subscribe" or "Get Started" button.
4. Once subscribed, find your **Primary Key** (also called a **Subscription Key**) for
   that product. It's a long string of letters/numbers. Copy it somewhere safe.

This key goes in `.env` as `MOMO_SUBSCRIPTION_KEY`.

## 2. Create a sandbox API user

The Collections API needs an "API user" (a sandbox identity tied to your subscription)
before it'll let you charge anything. This step is a raw API call, not a portal click —
either use the portal's own "Try it out" page for this endpoint if it has one, or run
this directly:

```powershell
# Generate a random ID for the new API user (any UUID works)
$apiUser = [guid]::NewGuid().ToString()
Write-Output $apiUser   # save this value

curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser" `
  -H "X-Reference-Id: $apiUser" `
  -H "Ocp-Apim-Subscription-Key: YOUR_SUBSCRIPTION_KEY" `
  -H "Content-Type: application/json" `
  -d '{\"providerCallbackHost\": \"localhost\"}'
```

A successful call returns no body, just a `201 Created` status. The `$apiUser` value you
generated **is** your API user ID going forward — save it.

This value goes in `.env` as `MOMO_API_USER`.

## 3. Create an API key for that user

```powershell
curl -X POST "https://sandbox.momodeveloper.mtn.com/v1_0/apiuser/$apiUser/apikey" `
  -H "Ocp-Apim-Subscription-Key: YOUR_SUBSCRIPTION_KEY"
```

This returns JSON like `{"apiKey": "..."}`. Copy that value.

This value goes in `.env` as `MOMO_API_KEY`.

## 4. Fill in `apps/server/.env`

```env
MOMO_BASE_URL="https://sandbox.momodeveloper.mtn.com"
MOMO_SUBSCRIPTION_KEY="<your Primary Key from step 1>"
MOMO_API_USER="<the UUID you generated in step 2>"
MOMO_API_KEY="<the key from step 3>"
MOMO_TARGET_ENVIRONMENT="sandbox"
MOMO_CURRENCY="EUR"
```

If these four MoMo variables aren't set, the app automatically falls back to its existing
simulated MoMo payment (real latency, occasional simulated decline, no real network call)
so nothing breaks for anyone running the project without sandbox credentials. Setting all
four switches MOMO payments over to the real MTN sandbox.

## 5. Important: the sandbox only accepts EUR

This is a long-standing MTN constraint, not a bug in this app: the sandbox environment is
shared across every country MTN operates in, so it only processes test transactions in
EUR regardless of which market (Rwanda, Uganda, etc.) you eventually launch in. The app's
real invoice/booking amounts are still displayed and stored in RWF everywhere — only the
amount actually sent to the sandbox API is in the test currency, controlled by
`MOMO_CURRENCY`. When you apply for and get approved for **production** access in Rwanda,
you'll get a different base URL and can set `MOMO_CURRENCY="RWF"` — a config change, not
a code change.

## 6. How to test it actually works

MTN's sandbox has special test phone numbers (MSISDNs) that deterministically simulate
outcomes, so you can demo both the success and failure path without needing a real phone
or real money. Check the **Collections sandbox testing guide** on the same developer
portal page you subscribed from for the current list of test numbers — they're typically
documented per-product. Use one that simulates `SUCCESSFUL` and one that simulates
`FAILED` to show both outcomes in this app:

- Generate an invoice payment with method MoMo using a "successful" test number → the
  invoice should flip to `PAID`.
- Try again with a "failed" test number → the payment should be rejected with a clear
  message, and the invoice stays unpaid.
- Same applies to the "Pay with MoMo now" option after a booking.
