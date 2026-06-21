# Baby Registry (DIY)

A soft, photo-forward baby registry you can host yourself for free. Friends and
family browse the gift list, claim the items they want to give, and leave a note —
and the app makes sure no two people accidentally buy the same thing.

**Stack:** [Next.js](https://nextjs.org) (deploys to [Vercel](https://vercel.com)) ·
AWS **DynamoDB** for data · AWS **S3** for uploaded photos. At one-registry scale it
runs at roughly **$0/month**.

![public + admin](https://img.shields.io/badge/Next.js-14-black) ![license](https://img.shields.io/badge/license-MIT-blue)

---

## What you get

- **Public site (`/`)** — a clean pastel grid of items. Guests add the ones they
  want to give to a **"My Gifts"** list (button, top-right), then confirm with their
  name and a message. The grid refreshes itself in the background.
- **Admin panel (`/admin`)** — log in, add / edit / delete items (name, link,
  quantity, photo), mark things purchased by hand, and see who claimed what and the
  message they left.
- **No double-gifting** — when a guest adds an item, the server claims a slot with an
  *atomic* DynamoDB write. If someone else just took the last one, the guest is told
  and the grid updates. Reservations auto-expire after 10 minutes (DynamoDB TTL), so
  abandoned carts free themselves. Items with quantity > 1 stay available (showing
  "2 of 3 left") until every unit is claimed.

---

## Set it up for yourself

You'll need: an **AWS account**, the **AWS CLI** (`aws configure`'d), **Node 18+**,
the **GitHub CLI** (`gh`), and a **Vercel** account. All free tiers.

### 1. Clone

```bash
git clone https://github.com/<your-username>/baby-registry-diy.git
cd baby-registry-diy
npm install
```

### 2. Provision AWS + generate your config (one command)

```bash
./scripts/setup-aws.sh
```

This creates a DynamoDB table, a private S3 bucket (with TTL + upload CORS), a
scoped IAM user with an access key, and writes a ready-to-go **`.env.local`** —
including a random session secret and a generated admin password (printed at the end).

Want your own admin login from the start? Pass them in:

```bash
ADMIN_USERNAME=myname ADMIN_PASSWORD='superSecret!' ./scripts/setup-aws.sh
```

Prefer to do it by hand? See **[Manual AWS setup](#manual-aws-setup)** below.

### 3. Run it locally

```bash
npm run dev          # http://localhost:3000   (admin at /admin)
```

### 4. Push to GitHub

```bash
gh auth login        # one-time
./scripts/publish.sh                 # creates "baby-registry-diy" and pushes
# or choose a name / make it private:
./scripts/publish.sh my-registry
VISIBILITY=private ./scripts/publish.sh my-registry
```

### 5. Deploy to Vercel

1. Go to **[vercel.com/new](https://vercel.com/new)** and import the repo. Next.js is
   auto-detected — defaults are fine.
2. Add the **Environment Variables** below (copy the values from your `.env.local`).
3. **Deploy.** Your registry is live at `https://<project>.vercel.app`, admin at `/admin`.

> Tip: with the [Vercel CLI](https://vercel.com/docs/cli) you can instead run
> `vercel` then `vercel --prod` from the project folder.

---

## Environment variables

| Variable | What it is |
|---|---|
| `ADMIN_USERNAME` | Admin login username |
| `ADMIN_PASSWORD` | Admin login password (change anytime, then redeploy) |
| `SESSION_SECRET` | Random string that signs the admin cookie (`openssl rand -hex 32`) |
| `AWS_REGION` | e.g. `us-east-1` |
| `DYNAMODB_TABLE` | Table name (default `baby-registry`) |
| `S3_BUCKET` | Your globally-unique bucket name |
| `AWS_ACCESS_KEY_ID` | From the scoped IAM user |
| `AWS_SECRET_ACCESS_KEY` | From the scoped IAM user |
| `NEXT_PUBLIC_REGISTRY_TITLE` | Header title, e.g. `Baby Smith` |
| `NEXT_PUBLIC_REGISTRY_SUBTITLE` | e.g. `We're having a baby!` |

`scripts/setup-aws.sh` fills all of these in for you.

---

## Adding items (admin)

For each item's photo you have three options, easiest first:

1. **Auto-fetch from link** — paste the product URL and click the button; it pulls the
   store's preview image. Works for most major retailers.
2. **Paste an image URL** directly.
3. **Upload a photo** — stored in your private S3 bucket, served via signed URLs.

---

## How it works (the reservation logic)

Each item has `quantity` "slots." Adding an item to a gift list runs a DynamoDB
`UpdateItem` with a `ConditionExpression` that only succeeds if a slot is genuinely
free (empty, or holding an expired reservation). That makes claiming atomic — two
people can't grab the same slot. Confirming converts a hold into a permanent claim;
abandoned holds disappear on their own via DynamoDB TTL. The S3 bucket stays private:
the app serves photos through short-lived presigned URLs, so nothing is publicly listable.

---

## Manual AWS setup

If you'd rather not run the script:

1. **DynamoDB table** — partition key `pk` (String), sort key `sk` (String),
   on-demand billing. Enable **TTL** on the attribute `ttl`.
2. **S3 bucket** — any unique name, keep "Block all public access" **on**. Add a CORS
   rule allowing `PUT` and `GET` from `*`.
3. **IAM user** — attach this inline policy (swap in your region, account id, names):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow",
         "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"],
         "Resource": "arn:aws:dynamodb:REGION:ACCOUNT_ID:table/baby-registry" },
       { "Effect": "Allow",
         "Action": ["s3:PutObject","s3:GetObject"],
         "Resource": "arn:aws:s3:::YOUR_BUCKET/*" }
     ]
   }
   ```

   Create an access key for it and put it in `.env.local`.

To remove everything later: `./scripts/teardown-aws.sh` (destructive).

---

## Project structure

```
app/
  page.tsx, RegistryClient.tsx     public registry + gift-list cart
  admin/                           login + dashboard
  api/                             reserve / release / confirm / img + admin endpoints
lib/
  db.ts        DynamoDB access + atomic slot-based holds/claims
  s3.ts        presigned upload / read URLs
  auth.ts      signed-cookie admin session
  og.ts        product-photo fetcher
  types.ts
scripts/
  setup-aws.sh     provision AWS + write .env.local
  teardown-aws.sh  remove everything (destructive)
  publish.sh       create GitHub repo + push
```

---

## License

[MIT](./LICENSE) — free to use, modify, and share. Happy nesting. 🍼
