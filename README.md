# Baby Registry

A personal baby registry app — guests browse a gift list, claim what they want to give, and leave a note. Atomic DynamoDB slot logic prevents double-gifting. Built with Next.js 14, deployed on Vercel, backed by AWS DynamoDB and S3.

**Live:** [baby-patel.vercel.app](https://baby-patel.vercel.app) · Admin at [/admin](https://baby-patel.vercel.app/admin)

![Next.js](https://img.shields.io/badge/Next.js-14-black) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## How it works

### Public registry (`/`)
- Guests browse a pastel grid of registry items with photos, prices, and store links
- They add items to a **My Gifts** list, then confirm with their name and a message
- The grid auto-refreshes every 6 seconds so availability is always current
- Items with `quantity > 1` show "X of Y left" until every unit is claimed

### Reservation logic
Each item has `quantity` slots in DynamoDB. Adding an item to a gift list runs an atomic `UpdateItem` with a `ConditionExpression` that only succeeds on a genuinely free slot — two guests can never grab the same slot simultaneously. Confirming converts a temporary hold into a permanent claim. Holds auto-expire via DynamoDB TTL (default 30 minutes, configurable).

**Tray persistence:** the gift list tray is saved to `localStorage` and restored on page reload, so a guest's holds survive a refresh or accidental tab close — the items stay reserved and show as "In your gifts" rather than "Reserved."

### Admin panel (`/admin`)
Password-protected dashboard to manage the registry:

- **Add item** — paste a product link, hit "Auto-fill from link" to pull the name, price, and photo automatically (works for Walmart, IKEA, and others; Amazon often blocks bots so manual entry is needed there). You can also upload a photo directly to S3 or paste an image URL.
- **Bulk add items** — paste multiple links (one per line or comma-separated). Each link is auto-filled in sequence and saved automatically. A live progress list shows status per item.
- **Edit** any item's name, price, quantity, photo, or URL
- **Mark purchased** — manually claim a slot (e.g. for gifts bought outside the registry)
- **Reset purchases** — clear all claims and holds for an item
- **Hide / Unhide** — archive items without deleting them
- **Delete** — permanently removes the item and all purchase records
- See who claimed what and remove individual claims

---

## Project structure

```
app/
  page.tsx                    Public registry page (SSR shell)
  RegistryClient.tsx          Gift grid, tray, checkout flow (client)
  admin/
    page.tsx                  Admin page (SSR auth check)
    AdminClient.tsx           Add / edit / bulk-add / manage items (client)
    login/page.tsx            Login form
  api/
    items/route.ts            GET  — public item listing
    reserve/route.ts          POST — claim a slot (creates a hold)
    release/route.ts          POST — release a single hold
    release-all/route.ts      POST — batch-release holds (used on page unload)
    confirm/route.ts          POST — convert holds → permanent claims
    img/route.ts              GET  — serve S3 photos via presigned URL
    admin/
      login/route.ts          POST — authenticate admin
      logout/route.ts         POST — clear admin session
      items/route.ts          GET/POST — list items / create item
      items/[id]/route.ts     PATCH/DELETE — update / delete item
      items/[id]/actions/     POST — markPurchased, removeSlot, clearAll
      og/route.ts             POST — fetch product metadata from a URL
      upload-url/route.ts     POST — get presigned S3 upload URL

lib/
  db.ts        DynamoDB access + atomic slot-based holds/claims
  s3.ts        Presigned upload / read URLs
  auth.ts      Signed-cookie admin session
  og.ts        Product info fetcher (Open Graph / JSON-LD / retailer parsing)
  types.ts     Shared TypeScript interfaces

scripts/
  setup-aws.sh        Provision DynamoDB + S3 + IAM user, write .env.local
  teardown-aws.sh     Tear down all AWS resources (destructive)
  publish.sh          Create GitHub repo and push

  add-registry-items.mjs   Utility: bulk-insert items directly into DynamoDB
                            (run locally with an AWS profile — bypasses the UI)
  clear-holds.mjs          Utility: delete all active holds from DynamoDB
                            (useful to reset stuck "Reserved" states)

.github/
  workflows/
    deploy.yml         GitHub Actions → Vercel deployment on push to main
```

---

## Setup

### Prerequisites
- Node 18+
- AWS account + AWS CLI configured
- Vercel account
- GitHub account + `gh` CLI (for `publish.sh`)

### 1. Install dependencies

```bash
npm install
```

### 2. Provision AWS

```bash
./scripts/setup-aws.sh
```

Creates a DynamoDB table, private S3 bucket (with TTL + CORS), a scoped IAM user, and writes a ready-to-go `.env.local`. The generated admin password is printed at the end.

To set your own credentials upfront:

```bash
ADMIN_USERNAME=myname ADMIN_PASSWORD='superSecret!' ./scripts/setup-aws.sh
```

### 3. Run locally

```bash
npm run dev    # http://localhost:3000
```

Admin at `http://localhost:3000/admin`.

### 4. Push to GitHub

```bash
gh auth login
./scripts/publish.sh my-registry         # defaults to public
VISIBILITY=private ./scripts/publish.sh my-registry
```

### 5. Deploy to Vercel

The project deploys automatically on every push to `main` via GitHub Actions (`.github/workflows/deploy.yml`).

**One-time setup — add these three secrets to your GitHub repo (Settings → Secrets → Actions):**

| Secret | Where to get it |
|--------|----------------|
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens → Create Token |
| `VERCEL_ORG_ID` | vercel.com → Team Settings → General → Team ID |
| `VERCEL_PROJECT_ID` | vercel.com → Project → Settings → General → Project ID |

**Also add all environment variables to Vercel** (Project → Settings → Environment Variables) — see the table below. After the first deploy the site is live; every subsequent `git push` deploys automatically.

> Alternatively, deploy manually with the Vercel CLI: `vercel --prod`

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ADMIN_USERNAME` | ✓ | Admin login username |
| `ADMIN_PASSWORD` | ✓ | Admin login password |
| `SESSION_SECRET` | ✓ | Signs the admin cookie — `openssl rand -hex 32` |
| `AWS_REGION` | ✓ | e.g. `us-east-1` |
| `DYNAMODB_TABLE` | ✓ | DynamoDB table name (default `baby-registry`) |
| `S3_BUCKET` | ✓ | S3 bucket name for uploaded photos |
| `AWS_ACCESS_KEY_ID` | ✓ | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | ✓ | IAM user secret key |
| `NEXT_PUBLIC_REGISTRY_TITLE` | ✓ | Displayed in the header, e.g. `Baby Patel` |
| `NEXT_PUBLIC_REGISTRY_SUBTITLE` | ✓ | Subtitle, e.g. `We're having a baby!` |
| `NEXT_PUBLIC_TAX_MULTIPLIER` | | Tax on displayed prices: `1.13` = 13%, `1` = none (default `1.13`) |
| `HOLD_TTL_SECONDS` | | How long a hold lasts before auto-expiring (default `1800` = 30 min) |

Copy `.env.local.example` to `.env.local` for local development.

---

## Manual AWS setup

If you prefer not to use the setup script:

1. **DynamoDB table** — partition key `pk` (String), sort key `sk` (String), on-demand billing. Enable **TTL** on the attribute `ttl`.
2. **S3 bucket** — keep "Block all public access" **on**. Add a CORS rule allowing `PUT` and `GET` from `*`.
3. **IAM user** — create an access key and attach this inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/baby-registry"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject","s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
    }
  ]
}
```

To remove all AWS resources: `./scripts/teardown-aws.sh` (destructive).

---

## Utility scripts

Both scripts use the `duvaire` AWS CLI profile and run from the project folder with `node`.

### Add items in bulk (bypass the UI)

```bash
node add-registry-items.mjs
```

Edit the `items` array at the top of the file to add products. Each entry needs `name`, `url`, `imageUrl`, `price`, and `quantity`. Connects directly to DynamoDB — useful for initial setup or importing a large list at once.

### Clear all active holds

```bash
node clear-holds.mjs
```

Scans DynamoDB for every `state = "hold"` slot and deletes them instantly. Confirmed purchases (`state = "claim"`) are untouched. Use this to unstick items that appear as "Reserved" when no one is actively buying.

---

## Notes on auto-fill

The admin's **Auto-fill from link** button (and bulk import) calls `/api/admin/og`, which fetches the product page and extracts the name, price, and image from Open Graph tags, JSON-LD structured data, and retailer-specific patterns.

- **Works well:** Walmart, IKEA, most general retailers
- **Inconsistent:** Amazon often serves a CAPTCHA or bot-check to server-side requests — add these manually or paste an image URL directly

---

## License

[MIT](./LICENSE) — free to use and adapt. Happy nesting. 🍼
