# VanGo — Setup Guide
## Get the real app running in 4 steps

---

## Step 1 — Install dependencies

Open Terminal, navigate to this folder, and run:

```bash
cd vango
npm install
```

This installs all the packages (Next.js, Supabase, Stripe, Tailwind, etc.).

---

## Step 2 — Create your Supabase project (free)

1. Go to **https://supabase.com** → click **Start your project** → sign up
2. Click **New Project** → name it `vango` → choose **Australia (Sydney)** region → create
3. Wait ~2 minutes for it to start
4. Go to **SQL Editor** (left sidebar) → **New Query**
5. Open the file `supabase/schema.sql` from this folder, paste the entire contents, and click **Run**
6. Go to **Storage** → **New Bucket** → name it `job-photos` → toggle **Public** ON → create
7. Go to **Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 3 — Create your Stripe account (free to start)

1. Go to **https://stripe.com** → click **Start now** → sign up
2. Stay in **Test mode** (toggle at top right) for now
3. Go to **Developers → API keys** and copy:
   - **Publishable key** → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
    - **Secret key** → `STRIPE_SECRET_KEY`
4. For the webhook secret: come back to this after you deploy to Vercel

---

## Step 4 — Add your keys and run

1. Copy `.env.local.example` → rename the copy to `.env.local`
2. Open `.env.local` and paste in all your keys from Steps 2 and 3
3. Run the app:

```bash
npm run dev
```

4. Open **http://localhost:3000** — your app is live locally! 🎉
