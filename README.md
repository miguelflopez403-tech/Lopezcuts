# Lopezcuts

Your own booking platform: a public site where clients book, and a private dashboard where you run the business. One database behind both.

```
index.html            Public site: booking, prices, portfolio, story, reviews
owner/index.html      Private dashboard (staff sign-in only)
assets/css, assets/js Styles and code for both
assets/js/config.js   The ONE file you edit to connect your database
assets/vendor/        The Supabase library, served from your own site
supabase/schema.sql   Database tables, security rules and booking logic
supabase/seed.sql     Starting data: your services, prices, hours, real reviews, YOUR owner email
vercel.json           Hosting settings and security headers
```

## Try it right now (demo mode)

With `config.js` left empty, everything runs in **demo mode**: sample data saved in your browser only. Open `index.html`, book a cut, then open `owner/index.html`, pick "Owner", and the booking is on your calendar. Pick "Employee" to see exactly what a barber you hire would see (no money anywhere).

Everything marked "(sample)" is made up for the demo. Nothing in demo mode is real or shared.

---

## Going live: what only you can do

About 45 minutes total. Do them in order.

### 1. Create the GitHub repo (5 min)
1. On github.com, click **New repository**, name it `lopezcuts`, set it to **Private**, and create it.
2. Tell Claude the name. Claude will push this code there and open a pull request.

### 2. Create the database on Supabase (15 min)
1. Go to supabase.com, sign up (free plan is fine to start), and click **New project**. Name it `lopezcuts`, pick a strong database password (save it in a password manager), and choose the **West US** region.
2. When it's ready, open **SQL Editor → New query**. Paste all of `supabase/schema.sql` and click **Run**. It should say "Success".
3. Open `supabase/seed.sql`. The last lines invite `miguel@lopezcuts.com` as owner (change it only if you'll sign in with a different email). Paste the whole file into a new query and **Run**.
4. Go to **Authentication → URL Configuration**:
   - **Site URL**: `https://lopezcuts.com` (use your Vercel address until the domain is set up)
   - **Redirect URLs**: add `https://lopezcuts.com/owner` and your Vercel address with `/owner` on the end
5. Go to **Authentication → Sign In / Providers → Email**: keep it on and keep **Confirm email** on.
6. Go to **Project Settings → API Keys** and copy the **Project URL** and the **Publishable key** (older projects call it the `anon` `public` key).
   - **Never** copy the `secret` or `service_role` key anywhere. That key skips all security.

### 3. Connect the site (2 min)
Open `assets/js/config.js` and paste the two values:
```js
supabaseUrl: 'https://YOUR-PROJECT.supabase.co',
supabaseKey: 'sb_publishable_...',
```
The publishable key is meant to be public. The database's security rules decide what it can do.

### 4. Put it online with Vercel (10 min)
1. Go to vercel.com, sign up with your GitHub account, click **Add New → Project**, and import the `lopezcuts` repo.
2. Framework preset: **Other**. No build command. Click **Deploy**.
3. You get an address like `lopezcuts.vercel.app`. Open it and you'll see your site, live.

### 5. Sign in as the owner (5 min)
1. Go to `your-site/owner` and choose **Email me a sign-in link instead**. Use the email you put in `seed.sql`.
2. Click the link in the email. You'll be asked to set up **2-step verification**: install Google Authenticator, Microsoft Authenticator, 1Password or Authy, scan the QR code, and enter the 6-digit code.
3. Go to **Settings → My account** and set a password so you don't need email links every time.
4. Go to **Settings → Business** and add your address (only sent in confirmation texts), then check **Settings → Hours** (the starting hours are copied from your Booksy: Sun 1:20 to 5:20 PM, Mon 3:20 to 5:20 PM, Tue 1 to 3:40 PM, Wed 5 to 7:40 PM, Fri 1 to 3:40 PM, Thu and Sat closed).

### 6. Point lopezcuts.com at it (10 min + waiting)
1. Buy `lopezcuts.com` (Cloudflare, Namecheap or Porkbun, about $10 to $20 a year).
2. In Vercel: **Project → Settings → Domains → Add** `lopezcuts.com` (and `www.lopezcuts.com`).
3. Vercel shows one or two DNS records. Add them at the place you bought the domain. It usually works within an hour.
4. Back in Supabase, make sure the Site URL and Redirect URLs use `https://lopezcuts.com`.

### 7. Recommended before you stop using Booksy
- **Email sending**: Supabase's built-in email only sends a few sign-in emails per hour. That's fine for you and a couple of staff. If you add more people, connect a free sender like Resend under **Authentication → Emails → SMTP Settings**.
- **Backups**: the free plan keeps no long-term backups. Export Clients and Money to CSV from the dashboard once a month, or upgrade to Supabase Pro ($25/month) for daily backups.
- **Moving off Booksy**: run both for 2 to 3 weeks. Add your Booksy appointments in the dashboard (New booking), put your new booking link in your Instagram bio, and text regulars the link. When new bookings are all coming through the site, turn off online booking in Booksy.

---

## How it's locked down

| Who | Can see | Can't see |
|---|---|---|
| Visitors on the site | Prices, open times, portfolio, published reviews | Any client, any appointment, any money, your address |
| Employee | Their own calendar and the clients they've served | Payments, tips, revenue, expenses, budgets, other barbers' books, team settings |
| Manager | Everything in the shop, including money | Team access and the activity log |
| Owner (you) | Everything | |

- **Invite-only.** The database refuses to create an account for any email you haven't invited (Settings → Team & access). A stranger can't sign up.
- **2-step verification is enforced by the database.** Even with your password, nobody can read client or money data as an owner or manager without the 6-digit code from your phone.
- **Rules live in the database, not the page.** Someone who copies the dashboard page or calls the database directly still gets nothing. Tested: visitors and employees get "permission denied" on every money and client table.
- **No double bookings.** The database itself rejects two bookings that overlap, even if two people tap "Book" at the same moment.
- **Activity log.** Every change to payments, expenses, budgets, prices, settings and team access is recorded with who and when. Nobody can edit or delete it.
- **Auto sign-out** after 30 minutes without activity. Remove someone's access with one switch and they're out immediately.
- **Your address stays private.** It's only in the confirmation texts you send.
- Security headers in `vercel.json` stop other sites from framing your pages and block scripts from anywhere but your own site. The dashboard is hidden from search engines.

## What it tracks (Booksy parity)

- **Clients**: profiles, phone, email, birthday, tags (VIP, Curly…), standing notes, dated notes, full visit history, visits, spend, average tip, no-shows, cancellations, "due back" date based on how often they come, blocked from online booking.
- **Appointments**: booked → confirmed → completed, no-show, cancelled (by client or shop, with reason), source (online, staff, walk-in, Booksy), reminder sent, reschedule, staff notes, client's message.
- **Services & add-ons**: prices, first-visit price, duration, online or in-shop only.
- **Staff**: chairs, working hours per day, time off, colors on the calendar, roles.
- **Money**: payments with method (cash, Venmo, Zelle, Cash App, Apple Pay, card), tips, expenses, monthly budgets, profit, CSV export.
- **Reviews**: clients review from their booking link after a visit; you approve before they show. Booksy reviews can be added word for word.
- **Portfolio**: upload photos from your phone; they're resized and appear on the site.
- **Supplies**: stock goes down with each checkout and flags reorders.
- **Reminders**: each morning, the Today page has a ready-to-send text for every unconfirmed client with their time, price, your address, a map link and a one-tap confirm link.

## Not built yet (good next steps)

- **Automatic texts** (no tapping "Open in Messages"): needs a Twilio account, about $1/month plus about 1¢ per text. A scheduled Supabase function would send the morning confirmations for you.
- **Card payments and deposits online**: Stripe, to charge a no-show fee or take a deposit when booking.
- **Spam protection** on the booking form (Cloudflare Turnstile) if fake bookings ever show up. Each phone number is already limited to 2 upcoming bookings.
- **Real photos.** The portfolio tiles are placeholders until you upload photos in Dashboard → Portfolio.
