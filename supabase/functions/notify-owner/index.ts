// Lopezcuts: phone notifications for the owner app (web push).
//
// Called two ways:
//  1. By Supabase Database Webhooks on appointments INSERT/UPDATE and security_events INSERT
//     (see NOTIFICATIONS-SETUP.md).
//     It re-reads the appointment from the database and only notifies once per event,
//     so a fake call can't send made-up messages or spam.
//  2. By the owner app (signed in): { action: 'setup' } returns the public key the phone
//     needs to subscribe, and { action: 'test' } sends a test notification to your phones.
// The push keys are created on the first call and stored in public.push_keys, which only
// this function can read. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Email alerts: add the secret RESEND_API_KEY (from resend.com). The address and on/off
// switches are in the dashboard (Settings → Notifications).
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
    if (payload.action === 'test-email') {
      const { data: st } = await sb.from('settings').select('notify_email').eq('id', 1).maybeSingle();
      const emailed = await sendEmail(st?.notify_email, { title: 'Lopezcuts email alerts are on', body: 'You\'ll get an email like this every time someone books online.', url: '/owner' }, req);
      return json({ emailed });
    }
    return json({ error: 'Unknown action' }, 400);
  }

  // ---- database webhook: failed sign-ins ----
  if (payload?.table === 'security_events' && payload?.record?.id) {
    const { data: ev } = await sb.from('security_events').select('*').eq('id', payload.record.id).maybeSingle();
    if (!ev || ev.notified_at || !ev.ip) return json({ skipped: 'nothing to notify' });
    const hourAgo = new Date(Date.now() - 36e5).toISOString();
    const { data: recent } = await sb.from('security_events').select('id, stage, notified_at').eq('ip', ev.ip).gte('at', hourAgo).order('at');
    const list = recent ?? [];
    const third = list.length === 3 && list[2].id === ev.id;
    const firstCode = ev.stage === 'code' && list.filter((r: any) => r.stage === 'code')[0]?.id === ev.id;
    if (!third && !firstCode) return json({ skipped: 'below alert threshold' });
    const { data: claimed } = await sb.from('security_events').update({ notified_at: new Date().toISOString() }).eq('id', ev.id).is('notified_at', null).select().maybeSingle();
    if (!claimed) return json({ skipped: 'already notified' });
    const who = ev.email ? ` using ${ev.email}` : '';
    const msg = firstCode
      ? { title: '⚠️ Wrong 2-step code on your dashboard', body: `Someone got past the password${who} but entered a wrong 2-step code (internet address ${ev.ip}). If this wasn't you, change your password now.${third ? ' That address is locked out for 1 hour.' : ''}`, url: '/owner#setup', tag: 'security-' + ev.ip }
      : { title: '🔒 Sign-in blocked', body: `3 failed sign-ins${who} from internet address ${ev.ip}. That address is locked out for 1 hour. If this wasn't you, nothing else is needed.`, url: '/owner#setup', tag: 'security-' + ev.ip };
    const { data: subs } = await sb.from('push_subscriptions').select('*, profiles!inner(role, active)').eq('profiles.active', true).in('profiles.role', ['owner', 'manager']);
    const sent = await sendAll(sb, subs ?? [], msg);
    const { data: st } = await sb.from('settings').select('notify_email').eq('id', 1).maybeSingle();
    const emailed = await sendEmail(st?.notify_email, msg, req);
    return json({ kind: 'security', sent, emailed });
  }

  // ---- database webhook: appointments ----
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
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
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
  const emailed = (kind === 'booked' ? st?.email_bookings : st?.email_cancels) !== false
    ? await sendEmail(st?.notify_email, msg, req) : 'off';
  return json({ kind, sent, devices: want.length, emailed });
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

// Email through Resend. Without a domain set up in Resend, it sends from onboarding@resend.dev,
// which only delivers to the email you signed up to Resend with (use miguel@lopezcuts.com).
async function sendEmail(to: string | null | undefined, msg: Record<string, string>, req: Request) {
  const key = env('RESEND_API_KEY');
  if (!key) return 'no RESEND_API_KEY secret';
  if (!to) return 'no email set';
  const site = env('SITE_URL') || 'https://www.lopezcuts.com';
  const link = site + (msg.url || '/owner');
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('EMAIL_FROM') || 'Lopezcuts <onboarding@resend.dev>',
      to: [to], subject: msg.title,
      text: `${msg.body}\n\nOpen your dashboard: ${link}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5"><p style="font-size:18px;margin:0 0 6px"><b>${esc(msg.title)}</b></p><p style="margin:0 0 16px">${esc(msg.body)}</p><p><a href="${link}" style="background:#d4b46a;color:#111;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open dashboard</a></p></div>`,
    }),
  });
  if (r.ok) return 'sent';
  const j = await r.json().catch(() => ({}));
  return 'failed: ' + String(j.message ?? r.statusText).slice(0, 200);
}
