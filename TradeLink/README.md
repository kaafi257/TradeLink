# TradeLink Food Wholesale

A React + TypeScript + Vite wholesale business website with a public customer homepage and an authenticated admin workspace, styled to match the approved TradeLink design references.

## Included
- Public wholesale homepage: rice, sugar, cooking oil, large-quantity positioning and quotation request form.
- Admin login using Supabase Auth.
- Dashboard matching the supplied visual direction: dark teal sidebar, gold active navigation, welcome warehouse banner, four KPI cards, sales overview chart, top products, recent activities, product/staff management panels and quick actions.
- Product catalogue create/edit, public catalogue reads from the same Supabase database.
- Full sales workflow: price a quotation → create an order → record the sale (stock is deducted automatically) → assign a delivery → mark it delivered. Every step is a database function, so money, stock and statuses cannot be edited directly through the API.
- Per-action permissions (price quotes, create orders, cancel orders, record sales, assign/update deliveries, adjust stock, edit products) that the owner switches on or off per role in Settings.
- Optional Cloudflare Turnstile CAPTCHA on the public quote form.
- Inventory overview, staff directory, customer enquiry directory, activity log, reports and settings pages.
- Three Supabase SQL migrations with RLS policies, role helpers, append-only audit tables, trigger-written activity log, a public catalogue view, the workflow functions and the permissions table.
- Supabase Edge Functions: `invite-staff` (securely invite staff) and `submit-quote` (CAPTCHA-checked quote form).
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
2. Open SQL Editor and run these four files, **in this order, once each** (every file is idempotent, so re-running is safe):
   1. `supabase/migrations/0001_tradelink_schema.sql` - tables, role-escalation protection, append-only inventory ledger and sales table, trigger-written activity log, validated and rate-limited `submit_quote`, and the `public_products` view (the public site never sees prices or stock).
   2. `supabase/migrations/0002_product_images.sql` - the `product-images` storage bucket for uploaded product photos.
   3. `supabase/migrations/0003_workflow_permissions.sql` - per-action permissions and the quote → order → sale → stock → delivery functions. After this, orders, sales, deliveries and quotation prices can change only through those functions.
   4. `supabase/migrations/0004_contact_settings.sql` - the contact channels (phone, WhatsApp, Telegram, email) shown on the website and edited in Admin → Communication.
   If you ran an older copy of 0001, run all of them again in order, and redeploy the site code at the same time.
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
Sign in as owner. Open Products → Add Product. Enter product name, category, SKU, package, unit, wholesale price, minimum order, stock, a photo (uploaded from your device, 5 MB max) and active status. Active products appear on the public homepage.

## 5. Quotes, orders, sales and deliveries
1. The public form creates a quotation (status `new`). It takes no payment.
2. **Quotations** → *Price* each line, which marks it `quoted`. Then *Create order* turns it into a confirmed order (once per quotation).
3. **Orders** → *Record sale*: saves the payment, deducts every line from stock and writes a `sale` movement per product in the inventory ledger. It refuses if stock is short. *Cancel* is only possible before a sale is recorded; after that, use an Inventory "return" adjustment.
4. **Orders** → *Assign delivery* (sold orders only) → **Deliveries** → *Start delivery* → *Mark delivered* (or *Failed*, then re-assign). Delivery staff see only the deliveries assigned to them.
5. Everything is written to the Activity Log by the database.

### Permissions
The owner always has every permission. In **Settings → Permissions by role** the owner chooses which of these each other role may do: price quotations, create orders, cancel orders, record sales, assign/manage any delivery, update own deliveries, adjust stock, edit products. Defaults are seeded by migration 0003 and never overwritten when you re-run it. The database enforces them, not just the menu. (Viewing pages is still decided by role, see `src/admin/nav.ts` and the RLS policies.)

## 6. Staff invitations
Deploy the Edge Function after installing and linking the Supabase CLI:
```bash
supabase functions deploy invite-staff
```
Supabase gives the function `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` automatically (do not try to set them with `supabase secrets set`; names starting with `SUPABASE_` are refused). Redeploy the function whenever `supabase/functions/invite-staff/index.ts` changes. The service-role key stays server-side only. It is not exposed to the browser. The Staff Management page has an invitation form that calls this function. Only the owner can invite a manager.

## 6b. Staff set their own password
The invitation email sends people to `/set-password`, where they choose a password. In Supabase → Authentication → URL Configuration add `https://YOUR-SITE/set-password` to Redirect URLs (and keep Site URL set to your site). The login page also has "Forgot password?".

## 6c. Product images
Handled by migration 0002 (step 2 above). Products take an uploaded image stored in the `product-images` bucket; there are no image URLs.

## 6d. CAPTCHA on the quote form (optional, recommended)
1. In Cloudflare → Turnstile, create a widget for your site. Copy the **site key** and **secret key**.
2. Deploy the function and set the secret:
```bash
supabase secrets set TURNSTILE_SECRET_KEY=your-turnstile-secret
supabase functions deploy submit-quote
```
3. Set `VITE_TURNSTILE_SITE_KEY` in `.env.local` and in Vercel, then redeploy. The form now shows the check and sends quotes through the function (the CSP in `vercel.json` already allows Turnstile).
4. To make the check mandatory, stop the form being called directly: run the commented `revoke execute on function public.submit_quote(...) from anon, authenticated;` line at the end of migration 0003. Do this only after step 3 works. The function uses the service role, which is unaffected.
Without `VITE_TURNSTILE_SITE_KEY` the form works as before (honeypot plus database rate limits).

## 7. GitHub and Vercel
1. Create a GitHub repository and upload the contents of this folder (not the ZIP itself). `.gitignore` keeps `.env.local` and `node_modules` out; check that no keys are committed.
2. In Vercel, import that GitHub repository.
3. Framework preset: Vite. Build command: `npm run build`. Output directory: `dist`.
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel → Project Settings → Environment Variables.
5. Redeploy after adding variables.

`vercel.json` includes an SPA rewrite so dashboard routes/client-side app rendering work after refresh.

## Before you go live
- **Add your real contact details** in Admin → Communication (needs migration 0004). Channels left empty are hidden from the website. The `VITE_CONTACT_*` variables still work as a fallback.
- **Replace the sample photos** in `public/img` (homepage banners) with TradeLink's own, and upload real product photos in Products.
- Confirm real package sizes, prices and minimum order quantities.
- Run `npm install` once and commit the updated `package-lock.json` (the project now uses react-router 7, which clears the two moderate `npm audit` advisories that affected 6.x).
- Test the RLS policies with anon, each staff role and the owner before taking real orders.
- Security headers (CSP etc.) are in `vercel.json`. If you load images or scripts from new hosts, add them to the CSP.
- Add email notifications and backups as required.

## Known limitations
- Payments are recorded, not processed: one sale per order, with the amount paid at the time of sale (use method *Credit* for unpaid). There is no later part-payment or refund screen yet.
- Stock is deducted when the sale is recorded, not reserved when the order is created.
- Expenses and profit reports are not built; charts and KPIs show recorded sales only (summed by `sales_by_day`).
- Page access is by role; only the actions listed under Permissions are configurable.
- Rate limits on the public form: 3 per phone, 8 per connection and 300 overall, per hour (connection limiting uses the `x-forwarded-for` header).

## App structure
- `src/pages` public site and login · `src/admin` signed-in workspace (lazy-loaded) · `src/lib` Supabase client, auth, formatting.
- Routes: `/` public, `/login`, `/admin` (dashboard), `/admin/products|quotations|orders|sales|deliveries|staff|inventory|reports|customers|activity|settings`.
