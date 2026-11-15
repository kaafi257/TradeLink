# TradeLink Food Wholesale

A React + TypeScript + Vite wholesale business website with a public customer homepage and an authenticated admin workspace, styled to match the approved TradeLink design references.

## Included
- Public wholesale homepage: rice, sugar, cooking oil, large-quantity positioning and quotation request form.
- Admin login using Supabase Auth.
- Dashboard matching the supplied visual direction: dark teal sidebar, gold active navigation, welcome warehouse banner, four KPI cards, sales overview chart, top products, recent activities, product/staff management panels and quick actions.
- Product catalogue create/edit, public catalogue reads from the same Supabase database.
- Quotations list and status workflow.
- Inventory overview, staff directory, customer enquiry directory, activity log, reports and settings pages.
- One Supabase SQL migration with RLS policies, role helpers, append-only audit tables, trigger-written activity log and a public catalogue view.
- Supabase Edge Function starter for securely inviting staff.
- Vercel SPA rewrite configuration.

## 1. Run locally
Install Node.js 20+ then:
```bash
npm install
cp .env.example .env.local   # then edit .env.local (it is git-ignored)
npm run dev
```
Open the local URL printed by Vite.

## 2. Configure Supabase
1. Create a Supabase project.
2. Open SQL Editor and run `supabase/migrations/0001_tradelink_schema.sql` **once**. It is the only migration: it is idempotent and always ends in the hardened state, so re-running it is safe. If you already ran the old 0001/0002, just run this file once over them (it also upgrades the quote function, so redeploy the site code at the same time).
   It provides: role-escalation protection (only an owner can touch owner/manager accounts), an append-only inventory ledger and sales table, an activity log written only by database triggers, validated and rate-limited quote submission, and a `public_products` view so the public site never sees prices or stock.
3. In Project Settings → API, copy the Project URL and publishable key (or legacy anon key).
4. Put them in `.env.local`:
```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```
5. Restart the dev server.

Never put the Supabase `service_role` key in a Vite environment variable or browser code.

## 2b. Turn OFF public signups (important)
In Supabase → Authentication → Sign In / Providers, disable **Allow new users to sign up**. Staff are added by invitation only. The app also refuses to open the admin area for any signed-in user without an active staff profile.

## 3. Create the first owner
The schema creates new profiles as `staff` by default. Create the first user through Supabase Authentication → Users (invite user or add user), then run this SQL in the Supabase SQL Editor, replacing the email:
```sql
update public.profiles
set role = 'owner', full_name = 'TradeLink Owner', active = true
where email = 'YOUR-OWNER-EMAIL';
```
Sign in using that user. Do not make public signup an owner workflow.

## 4. Add products
Sign in as owner. Open Products → Add Product. Enter product name, category, SKU, package, unit, wholesale price, minimum order, stock, image URL and active status. Active products appear on the public homepage.

## 5. Quote requests
The public form inserts a row into `public.quotations`. Authenticated staff with owner/manager/sales role can view and update quotation status. The form does not take payments.

## 6. Staff invitations
Deploy the Edge Function after installing and linking the Supabase CLI:
```bash
supabase functions deploy invite-staff
```
Supabase gives the function `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically (do not try to set them with `supabase secrets set`; names starting with `SUPABASE_` are refused). Redeploy the function whenever `supabase/functions/invite-staff/index.ts` changes. The service-role key stays server-side only. It is not exposed to the browser. The Staff Management page has an invitation form that calls this function. Only the owner can invite a manager.

## 6b. Staff set their own password
The invitation email sends people to `/set-password`, where they choose a password. In Supabase → Authentication → URL Configuration add `https://YOUR-SITE/set-password` to Redirect URLs (and keep Site URL set to your site). The login page also has "Forgot password?".

## 6c. Product images
Run `supabase/migrations/0002_product_images.sql` once in the SQL Editor. Products now take an uploaded image (stored in the `product-images` bucket) instead of a link.

## 7. GitHub and Vercel
1. Create a GitHub repository and upload the contents of this folder (not the ZIP itself). `.gitignore` keeps `.env.local` and `node_modules` out; check that no keys are committed.
2. In Vercel, import that GitHub repository.
3. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel → Project Settings → Environment Variables.
5. Redeploy after adding variables.

`vercel.json` includes an SPA rewrite so dashboard routes/client-side app rendering work after refresh.

## Production checklist / limitations to finish before taking live orders
- Replace sample external stock photos with TradeLink-approved product and warehouse images.
- Confirm actual product package sizes, price rules and minimum order quantities.
- Add the real business contact details and support channels.
- Connect sales/order creation, inventory movement RPC transactions, payment reconciliation, delivery assignment, expenses and profit reports to agreed business workflows. The current project includes their database foundations and dashboard sections but does not yet implement every transaction workflow.
- Granular per-action permissions are not implemented; RLS uses role-based module access (the menu mirrors it).
- Consider adding Cloudflare Turnstile/hCaptcha to the public quote form. Today it has a honeypot field plus database rate limits (3 per phone, 8 per connection and 300 overall, per hour). Rate limiting by connection relies on the `x-forwarded-for` header Supabase passes to the database.
- Orders, deliveries and sales recording screens are still to be built; the Sales page lists rows from the `sales` table once they exist.
- Configure Storage buckets and policies if you want image uploads rather than image URLs.
- Review and test RLS policies with anon, each staff role and owner before production. (The policies were exercised against a local Postgres: public cannot read `products`; inventory movements, sales and the activity log cannot be edited or deleted through the API; managers cannot change other managers.)
- `npm audit` reports 2 moderate advisories in `react-router` 6.x; their fix needs the v7 upgrade. They concern SSR hydration and backslash redirects, which this client-only app does not use, but plan the upgrade.
- Security headers (CSP etc.) are set in `vercel.json`. If you load images or scripts from new hosts, add them to the CSP.
- Add email notifications and backups as required.
- Charts and KPIs show only recorded sales (summed in the database by `sales_by_day`); with no sales they show an empty state.
- The quote workflow is still only an inbox: staff cannot yet price a quote, convert it to an order, record the sale or deduct stock from the app.

## App structure
- `src/pages` public site and login · `src/admin` signed-in workspace (lazy-loaded) · `src/lib` Supabase client, auth, formatting.
- Routes: `/` public, `/login`, `/admin` (dashboard), `/admin/products|quotations|sales|staff|inventory|reports|customers|activity|settings`.
