# AsphaltPro

A no-build, no-server web app for an asphalt paving company: win work, manage jobs, run the business.
Pure HTML/CSS/JS — open `index.html` or host it free on **GitHub Pages**.

## Run it
- **Locally:** open `index.html` in a browser (or `python3 -m http.server`).
- **GitHub Pages:** merge to `main`, then *Settings → Pages → Source: GitHub Actions*. The included workflow publishes the site.

Data is saved in your browser (localStorage). Use **Settings → Export JSON** to back up or move devices. It ships with demo data; *Settings → Start empty* clears it.

## Features
| Area | What it does |
|---|---|
| **CRM** | Leads → prospects → customers, contact info, activity log, per-customer estimates/jobs/invoices |
| **Mapping, Estimates & Proposals** | Spreadsheet-style item grid (paste from Excel, Enter/arrow navigation, section headings), Excel proposal import, lump-sum toggle that hides unit prices from the customer, satellite map measuring, printable proposal, e-signature. Open proposals are colour-coded by age (green ≤90 days, yellow 90–180, red older) and filterable by colour and date |
| **Scheduling & Dispatch** | Drag-and-drop week board by crew, multi-day jobs, unscheduled tray, day dispatch sheet (print/copy for crews) |
| **Job Sites** | Mobile-friendly job page: start/complete, daily logs (weather, crew, tons), checklists, photos |
| **Job Costing** | Budget vs actual by material/labor/equipment/other, live margin, cross-job costing table |
| **Customer Portal** | Per-customer page: sign proposals, track project status & updates, view/pay invoices, message the office |
| **Analytics** | Pipeline, win rate, cash collected, A/R, margins, charts |
| **Invoicing & Payments** | Invoice from job balance, send, record card/ACH/check payments, overdue tracking |
| **Automation** | Rules + inbox: signed proposal → create job & alert owner, job complete → draft invoice, budget threshold & overdue alerts, new-lead alerts |

## Importing existing projects
*Settings → Import projects file* merges a prepared JSON file of customers, proposals and jobs into your data. It never overwrites or duplicates (each project has a key), and creates no alerts or invoices. Keep these files out of the repository — they contain customer data.

## Shared backend (so customers can use portal links)
Without setup the app runs in **demo mode** (data in your browser only). To go live with staff logins and real customer links, connect a free [Supabase](https://supabase.com) project (~10 minutes):

1. **Create a project** at supabase.com. Then *Authentication → Providers → Email*: keep email sign-in on and turn **off** "Allow new users to sign up" (you invite staff yourself).
2. **Create the database:** *SQL Editor* → paste all of [`supabase/schema.sql`](supabase/schema.sql) → Run.
3. **Add staff:** *Authentication → Users → Add user* (email + password), then in the SQL Editor run
   `insert into public.staff(email) values ('you@yourcompany.com');` — only emails in this table can read or write company data.
4. **Connect the app:** copy *Project Settings → API* → Project URL and the `anon` public key into [`js/config.js`](js/config.js), commit, and push to `main`.
5. Open the site, sign in, and choose *Empty / Demo / Use data from this browser* on first run.

**How customer links work:** every customer gets a private 64-character link (CRM → customer → 🔗 *Copy portal link*, or the Customer Portal page). The link shows only that customer's proposals (non-draft), jobs (status, schedule, log notes, a few photos) and invoices (non-draft). Costs, budgets, notes and other customers are never sent. Customers can e-sign a proposal that is *sent*, message the office, and request to pay an invoice. *Reset link* on the customer revokes it. Customers have no database access at all; the portal runs through four locked-down database functions, and I tested those against Postgres, including that a token can't touch another customer's records.

When a customer signs or messages, the event waits in the database. The next time a staff member has the app open (checked every 20 s) your automations run — job created, owner alerted, and so on.

**Things to know**
- Sync is "last save wins" per record; two people editing the *same* estimate/job at the same moment will overwrite each other. Different records are fine.
- Photos are stored inside job records (resized), fine for light use; move them to Supabase Storage if you take many.
- **Pay now** in the portal sends the office a payment request; it does not charge a card. Real card/ACH needs a processor (Stripe/Square) and a small server function — the next step.
- Not yet: email/SMS delivery of links and alerts, and per-role permissions (every staff login can see everything).
