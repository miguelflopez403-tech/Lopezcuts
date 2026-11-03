# Turning on automatic texts

Lopezcuts sends four texts on its own once this is set up:

| When | Text |
|---|---|
| A client books | "Your booking went through… Miguel will text you the day of your appointment" + link to change it |
| You move their appointment | New time + link to change it |
| You cancel their appointment | Sorry note (with your reason, if you typed one) + link to book again |
| Day after their cut | Thank you, rebook, review link, refer a friend (first cuts $25) |

Clients who cancel themselves are not texted. Nothing is sent until you switch it on in step 5.
The wording lives in `supabase/schema.sql` → `sms_body`; ask Claude to change it.

**Keep your Twilio keys to yourself.** You paste them straight into Supabase.
Don't send them in chat or put them in the code.

---

## 1. Database (2 minutes)

1. Supabase → **Integrations** → **Cron** → **Enable**.
2. Supabase → **SQL Editor** → New query → paste
   [`supabase/updates/2026-11-03-auto-texts.sql`](supabase/updates/2026-11-03-auto-texts.sql) → **Run**.
   The last line should say `texts_ready = true`. If you see "Cron is not on yet", do step 1 and run it again.

## 2. Twilio account (15 minutes, then a few days for approval)

1. Sign up at <https://www.twilio.com/try-twilio> with miguel@lopezcuts.com.
2. **Upgrade** the account and add a card. A trial account can only text numbers you've verified yourself.
3. Get a number. Phone Numbers → Buy a number. Twilio shows the monthly price before you pay.
   - **Local number (571 area code):** clients see a local number. You must complete **A2P 10DLC** registration first,
     choosing **Sole Proprietor** if you don't have an EIN. There are small one-time and monthly carrier fees.
   - **Toll-free number:** often simpler. You complete **Toll-Free Verification** instead.
   Either way, describe the use as: *"Appointment confirmations, changes and thank-you messages for clients who book a haircut on lopezcuts.com."*
   Carriers block texts until the registration or verification is approved, which usually takes a few days.
4. Messaging → Services → **Create Messaging Service** ("Lopezcuts"), then add your number to it.
   Note the **Messaging Service SID** (starts with `MG`).
5. On the Twilio Console home page, note your **Account SID** (starts with `AC`) and **Auth Token**.

## 3. Sending function (5 minutes)

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `send-text`.
3. Replace the sample code with everything in
   [`supabase/functions/send-text/index.ts`](supabase/functions/send-text/index.ts), then click **Deploy**.
4. Edge Functions → **Secrets** → add these three:
   - `TWILIO_ACCOUNT_SID` = your AC… value
   - `TWILIO_AUTH_TOKEN` = your auth token
   - `TWILIO_MESSAGING_SERVICE_SID` = your MG… value

## 4. Connect the database to the function (2 minutes)

Supabase → **Database** → **Webhooks** → **Create a new hook**:
- Name: `send-text`
- Table: `sms_outbox`
- Events: **Insert** only
- Type: **Supabase Edge Functions** → function `send-text`, method POST
- Under HTTP Headers, click **Add auth header with service key**
- Click **Create webhook**

## 5. Test it

In the dashboard, open **Settings → Texts**, turn on **Send texts automatically** and save.
Then book yourself on lopezcuts.com with your own cell number.
Within a few seconds the text appears under **Recent texts** as **Sent**, and it arrives on your phone.
If it says **Failed**, the reason is shown next to it. Send Claude a screenshot.

## 6. Done

Leave the switch on. To pause all texts, turn it off. Messages that are already sent stay in the log.
