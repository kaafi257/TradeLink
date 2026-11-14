# TradeLink Food Wholesale

A React + TypeScript + Vite wholesale business website with a public customer homepage and an authenticated admin workspace, styled to match the approved TradeLink design references.

## Included
- Public wholesale homepage: rice, sugar, cooking oil, large-quantity positioning and quotation request form.
- Admin login using Supabase Auth.
- Dashboard matching the supplied visual direction: dark teal sidebar, gold active navigation, welcome warehouse banner, four KPI cards, sales overview chart, top products, recent activities, product/staff management panels and quick actions.
- Product catalogue create/edit, public catalogue reads from the same Supabase database.
- Quotations list and status workflow.
- Inventory overview, staff directory, customer enquiry directory, activity log, reports and settings pages.
- Supabase SQL schema with RLS policies, role helper functions and profile creation trigger.
- Supabase Edge Function starter for securely inviting staff.
- Vercel SPA rewrite configuration.

## 1. Run locally
Install Node.js 20+ then:
```bash
npm install
cp .env.example .env.local
npm run dev
```
Open the local URL printed by Vite.

## 2. Configure Supabase
1. Create a Supabase project.
2. Open SQL Editor and run `supabase/migrations/0001_tradelink_schema.sql`, then `0002_security_hardening.sql` (both are safe to re-run).
   0002 adds: role-escalation protection, database-stamped activity log, validated + rate-limited quote submission, and recorded stock adjustments.
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
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```
The function uses the service-role key server-side only. It is not exposed to the browser. The Staff Management page has an invitation form that calls this function. Only the owner can invite a manager.

## 7. GitHub and Vercel
1. Create a GitHub repository and upload the contents of this folder (not the ZIP itself).
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
- Consider adding Cloudflare Turnstile/hCaptcha to the public quote form. Today it has a honeypot field plus a database rate limit (3 requests per phone per hour, 100 per hour overall).
- Orders, deliveries and sales recording screens are still to be built; the Sales page lists rows from the `sales` table once they exist.
- Configure Storage buckets and policies if you want image uploads rather than image URLs.
- Review and test RLS policies with anon, each staff role and owner before production.
- Add email notifications and backups as required.
- Charts and KPIs show only recorded sales; with no sales they show an empty state.

## App structure
- `src/pages` public site and login · `src/admin` signed-in workspace (lazy-loaded) · `src/lib` Supabase client, auth, formatting.
- Routes: `/` public, `/login`, `/admin` (dashboard), `/admin/products|quotations|sales|staff|inventory|reports|customers|activity|settings`.
