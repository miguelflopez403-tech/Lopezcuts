// Lopezcuts: phone notifications for the owner app (web push).
//
// Called two ways:
//  1. By the Supabase Database Webhook on appointments INSERT/UPDATE (see NOTIFICATIONS-SETUP.md).
//     It re-reads the appointment from the database and only notifies once per event,
//     so a fake call can't send made-up messages or spam.
//  2. By the owner app (signed in): { action: 'setup' } returns the public key the phone
//     needs to subscribe, and { action: 'test' } sends a test notification to your phones.
// The push keys are created on the first call and stored in public.push_keys, which only
// this function can read. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';

const env = (k: string) => Deno.env.get(k) ?? '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const payload = await req.json().catch(() => ({}));

  // ---- keys (made once, kept in the database) ----
  let { data: keys } = await sb.from('push_keys').select('*').eq('id', 1).maybeSingle();
  if (!keys) {
    const k = webpush.generateVAPIDKeys();
    await sb.from('push_keys').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey }, { onConflict: 'id', ignoreDuplicates: true });
    ({ data: keys } = await sb.from('push_keys').select('*').eq('id', 1).maybeSingle());
  }
  if (!keys) return json({ error: 'Could not create notification keys. Did you run the notifications SQL?' }, 500);
  webpush.setVapidDetails('mailto:miguel@lopezcuts.com', keys.public_key, keys.private_key);

  // ---- calls from the owner app ----
  if (payload?.action) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: 'Please sign in again.' }, 401);
    const { data: prof } = await sb.from('profiles').select('role, active').eq('id', u.user.id).maybeSingle();
    if (!prof?.active) return json({ error: 'Not allowed.' }, 403);
    if (payload.action === 'setup') return json({ publicKey: keys.public_key });
    if (payload.action === 'test') {
      const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', u.user.id);
      const sent = await sendAll(sb, subs ?? [], { title: 'Lopezcuts', body: 'Notifications are on. You\'ll get one every time someone books.', url: '/owner', tag: 'test' });
      return json({ sent, devices: (subs ?? []).length });
    }
    return json({ error: 'Unknown action' }, 400);
  }

  // ---- database webhook ----
  if (payload?.table !== 'appointments' || !payload?.record?.id) return json({ skipped: 'not an appointment event' });
  const { data: a } = await sb.from('appointments').select('*').eq('id', payload.record.id).maybeSingle();
  if (!a) return json({ skipped: 'not found' });
  const fresh = (t: string | null) => !!t && Date.now() - new Date(t).getTime() < 15 * 60e3;
  let kind = '';
  if (payload.type === 'INSERT' && a.source === 'online' && fresh(a.created_at)) kind = 'booked';
  else if (payload.type === 'UPDATE' && a.status === 'cancelled' && a.cancelled_by === 'client' && fresh(a.cancelled_at)) kind = 'cancelled';
  if (!kind) return json({ skipped: 'nothing to notify' });

  // once per appointment per kind
  const { error: dup } = await sb.from('push_sent').insert({ appointment_id: a.id, kind });
  if (dup) return json({ skipped: 'already notified' });

  const [{ data: st }, { data: c }, { data: svc }] = await Promise.all([
    sb.from('settings').select('timezone').eq('id', 1).maybeSingle(),
    sb.from('clients').select('full_name').eq('id', a.client_id).maybeSingle(),
    sb.from('services').select('name').eq('id', a.service_id).maybeSingle(),
  ]);
  const when = new Date(a.starts_at).toLocaleString('en-US', { timeZone: st?.timezone || 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const name = c?.full_name || 'A client';
  const msg = kind === 'booked'
    ? { title: `New booking: ${name}`, body: `${svc?.name ?? 'Haircut'} · ${when}${a.price != null ? ` · $${Number(a.price).toFixed(0)}` : ''}`, url: '/owner#calendar', tag: 'appt-' + a.id }
    : { title: `Cancelled: ${name}`, body: `${when} is open again${a.cancel_reason ? ` · "${String(a.cancel_reason).slice(0, 80)}"` : ''}`, url: '/owner#calendar', tag: 'appt-' + a.id };

  // who gets it: owner/manager see everything, employees only their own chair
  const { data: subs } = await sb.from('push_subscriptions').select('*, profiles!inner(role, staff_id, active)').eq('profiles.active', true);
  const want = (subs ?? []).filter((s: any) => (kind === 'booked' ? s.notify_bookings : s.notify_cancels)
    && (s.profiles.role !== 'employee' || s.profiles.staff_id === a.staff_id));
  const sent = await sendAll(sb, want, msg);
  return json({ kind, sent, devices: want.length });
});

async function sendAll(sb: any, subs: any[], msg: Record<string, string>) {
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 3600, urgency: 'high' });
      sent++; await sb.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e: any) {
      // the phone turned notifications off or the app was removed
      if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
    }
  }
  return sent;
}
