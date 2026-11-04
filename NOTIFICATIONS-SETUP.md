# Booking notifications on your phone

You get a notification every time someone books online, and (if you want) when a client cancels.
It's free. No Twilio or app store needed. About 10 minutes, one time.

## 1. Database (2 minutes)

Supabase → **SQL Editor** → New query → paste
[`supabase/updates/2026-11-04-notifications.sql`](supabase/updates/2026-11-04-notifications.sql) → **Run**.
The last line should say `notifications_ready = true`.

## 2. Sending function (3 minutes)

1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly `notify-owner`.
3. Replace the sample code with everything in
   [`supabase/functions/notify-owner/index.ts`](supabase/functions/notify-owner/index.ts), then click **Deploy**.

No secrets to add. The function makes its own sending keys the first time it runs and keeps them in the database
where only it can read them.

## 3. Connect bookings to the function (2 minutes)

Supabase → **Database** → **Webhooks** → **Create a new hook**:
- Name: `notify-owner`
- Table: `appointments`
- Events: **Insert** and **Update**
- Type: **Supabase Edge Functions** → function `notify-owner`, method POST
- Under HTTP Headers, click **Add auth header with service key**
- Click **Create webhook**

## 4. Put the owner app on your iPhone (2 minutes)

iPhones only show notifications from apps on your Home Screen, so do this first.

1. Open **Safari** (not Chrome) and go to **www.lopezcuts.com/owner**.
2. Tap the **Share** button (the square with an arrow, at the bottom).
3. Scroll down and tap **Add to Home Screen**, then **Add**.
4. Close Safari and open **Lopezcuts** from your Home Screen. It opens full screen like a normal app.
5. Sign in (email + your 2-step code). It stays signed in until you've been idle for 30 minutes.

Needs iOS 16.4 or newer (Settings → General → About → iOS Version).
If you added it to your Home Screen before November 4, delete that icon and add it again so it picks up the fix.

On Android: open the page in Chrome → ⋮ menu → **Add to Home screen** (or **Install app**).

## 5. Turn on notifications (1 minute)

In the Home Screen app: **Settings → Notifications → Turn on notifications** → **Allow**.
You'll get a test notification right away. Do this on each phone or computer you want alerts on.

You can choose per phone:
- **Someone books online** (on by default)
- **A client cancels** (on by default)

Bookings you add yourself in the dashboard don't send a notification. Employees only get alerts for their own chair.

## If it doesn't work

- **No "Turn on" button, just Home Screen steps:** you're in Safari. Open the Home Screen app instead.
- **"Blocked":** iPhone Settings → Notifications → Lopezcuts → Allow Notifications.
- **Test says it couldn't reach notify-owner:** step 2 isn't deployed, or the name isn't exactly `notify-owner`.
- **Test works but bookings don't notify:** check the webhook in step 3 (table `appointments`, Insert and Update).
- Supabase → Edge Functions → notify-owner → **Logs** shows each try. Send Claude a screenshot.
