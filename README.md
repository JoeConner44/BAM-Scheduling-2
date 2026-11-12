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
| **Mapping, Estimates & Proposals** | Take-off table (L×W×depth → tons), satellite map measuring (area & linear ft, Esri imagery), editable price list, printable proposal, on-screen e-signature |
| **Scheduling & Dispatch** | Drag-and-drop week board by crew, multi-day jobs, unscheduled tray, day dispatch sheet (print/copy for crews) |
| **Job Sites** | Mobile-friendly job page: start/complete, daily logs (weather, crew, tons), checklists, photos |
| **Job Costing** | Budget vs actual by material/labor/equipment/other, live margin, cross-job costing table |
| **Customer Portal** | Per-customer page: sign proposals, track project status & updates, view/pay invoices, message the office |
| **Analytics** | Pipeline, win rate, cash collected, A/R, margins, charts |
| **Invoicing & Payments** | Invoice from job balance, send, record card/ACH/check payments, overdue tracking |
| **Automation** | Rules + inbox: signed proposal → create job & alert owner, job complete → draft invoice, budget threshold & overdue alerts, new-lead alerts |

## Limits / roadmap
This is a front-end-only first version. To go multi-user and customer-facing for real:
1. Shared backend (e.g. Supabase/Firebase) for accounts + live data, so portal links work for customers.
2. Real payments (Stripe/Square) behind the "Pay now" button.
3. Email/SMS delivery for proposals, invoices, dispatch, and alerts.
4. Role-based logins (Owner / Estimator / Office / Foreman).

Map measuring needs internet (Leaflet + Esri tiles via CDN); everything else works offline.
