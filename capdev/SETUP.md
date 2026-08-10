# Setting this up — plain-language walkthrough

For whoever is doing the technical setup. Roughly 30 minutes.

## What you're building

A web app where QA analysts sign in with their work Google account, upload call
recordings, and evaluate them. This milestone covers sign-in only — the rest
comes next.

## 1. Create the Supabase project

1. Go to supabase.com, sign up, click **New project**
2. Name it `capdev`, pick a region near your team, set a database password
   (save it in a password manager — you'll rarely need it, and never in code)
3. Wait about two minutes for it to provision

## 2. Create the database tables

In the Supabase dashboard, open **SQL Editor**. Run each file from
`supabase/migrations/` **in numerical order**, one at a time, waiting for
success before the next:

```
0001_foundation.sql
0002_identity.sql
0003_audit.sql
0004_rls.sql
0005_seed.sql
```

Order matters — each depends on the one before.

## 3. Add yourself as the first administrator

Still in SQL Editor, replacing the email with yours:

```sql
insert into public.person (org_id, email, display_name, status)
select id, 'you@yourcompany.com', 'Your Name', 'invited'
from public.organization where slug = 'atticus';

insert into public.role_assignment (org_id, person_id, role_id)
select o.id, p.id, r.id
from public.organization o
join public.person p   on p.org_id = o.id and p.email = 'you@yourcompany.com'
join public.app_role r on r.org_id = o.id and r.code  = 'administrator';
```

Status `invited` becomes `active` automatically on your first sign-in.

## 4. Turn on Google sign-in

1. Supabase dashboard → **Authentication → Providers → Google** → enable
2. It shows a **Callback URL** — copy it
3. In Google Cloud Console: create an OAuth client (Web application), paste that
   callback URL into *Authorised redirect URIs*
4. Copy the Client ID and Secret back into Supabase, save

## 5. Connect the app

1. Supabase dashboard → **Settings → API**
2. Copy the **Project URL** and the **anon public** key
3. `cp web/.env.example web/.env.local` and paste both in

The anon key is safe in a browser — it's public by design. Access is controlled
by the security policies in `0004_rls.sql`, not by keeping the key secret.
**The `service_role` key is different: it bypasses all security. Never put it in
the web app.**

## 6. Run it

```
cd web
npm install
npm run dev
```

Open http://localhost:5173 and sign in with the Google account from step 3.

## 7. Put it online

1. Push this repository to GitHub
2. Go to vercel.com → **Import Project** → pick the repo
3. Set **Root Directory** to `web`
4. Add the same two environment variables from step 5
5. Deploy
6. Copy the Vercel URL back into Supabase → **Authentication → URL
   Configuration → Site URL**, or Google sign-in will bounce you to localhost

## If sign-in fails

**"redirect_uri_mismatch"** — the callback URL in Google Cloud doesn't exactly
match Supabase's. Check for a trailing slash.

**Signs in but says "No access yet"** — the Google account's email doesn't match
any `person` row. Check step 3 for a typo.

**Blank page** — `.env.local` is missing or misspelled. The app is designed to
fail loudly here; check the browser console.
