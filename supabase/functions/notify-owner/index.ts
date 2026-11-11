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
// Client emails: when a client gave an email, they get a confirmation (and an update if the
// booking is moved or cancelled). These only send once the secret EMAIL_FROM is set to an
// address on a domain verified in Resend, e.g. "Lopez Cuts <bookings@lopezcuts.com>".
// Reminder emails: the database calls this hourly with { cron: 'reminders' } when an appointment
// is 12 to 24 hours away. The function asks the database which ones are due and claims them,
// so a fake call can only send reminders that were due anyway, and never twice.
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

  // ---- hourly reminder emails (the day before) ----
  if (payload?.cron === 'reminders') {
    const { data: ids, error } = await sb.rpc('claim_email_reminders');
    if (error) return json({ error: 'Reminders are not set up yet. Run the reminder emails SQL.' }, 500);
    const { data: st } = await sb.from('settings').select('*').eq('id', 1).maybeSingle();
    const results: string[] = [];
    for (const id of ((ids ?? []) as string[]).slice(0, 50)) {
      let res = 'failed';
      const { data: a } = await sb.from('appointments').select('*').eq('id', id).maybeSingle();
      try {
        if (!a || !['booked', 'confirmed'].includes(a.status)) res = 'skipped';
        else {
          const [{ data: c }, { data: svc }] = await Promise.all([
            sb.from('clients').select('full_name, email').eq('id', a.client_id).maybeSingle(),
            sb.from('services').select('name').eq('id', a.service_id).maybeSingle(),
          ]);
          res = await sendClientEmail('reminder', a, c, svc?.name ?? 'Haircut', st, '');
        }
      } catch (e: any) { res = 'failed: ' + String(e?.message || e).slice(0, 160); }
      // a failed send is released so the next hourly run tries again
      if (res.startsWith('failed') && a) await sb.from('email_reminders').delete().eq('appointment_id', id).eq('starts_at', a.starts_at);
      results.push(res);
    }
    return json({ kind: 'reminders', results });
  }

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
      return json({ sent, devices: (subs ?? []).length, errors: lastErrors });
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
  else if (payload.type === 'INSERT' && a.source !== 'walk_in' && fresh(a.created_at)) kind = 'manual';
  else if (payload.type === 'UPDATE' && a.status === 'cancelled' && payload.old_record?.status !== 'cancelled' && fresh(a.cancelled_at)) kind = 'cancelled';
  else if (payload.type === 'UPDATE' && ['booked', 'confirmed'].includes(a.status) && payload.old_record?.starts_at && new Date(payload.old_record.starts_at).getTime() !== new Date(a.starts_at).getTime() && new Date(payload.record?.starts_at).getTime() === new Date(a.starts_at).getTime()) kind = 'moved';
  else if (payload.type === 'UPDATE' && a.status === 'confirmed' && payload.old_record?.status !== 'confirmed' && fresh(a.confirmed_at)) kind = 'confirmed';
  if (!kind) return json({ skipped: 'nothing to notify' });

  // once per appointment per kind
  // a booking can be moved more than once, so each new time counts as its own event
  const { error: dup } = await sb.from('push_sent').insert({ appointment_id: a.id, kind: kind === 'moved' ? 'moved ' + a.starts_at : kind });
  if (dup) return json({ skipped: 'already notified' });

  const [{ data: st }, { data: c }, { data: svc }] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('clients').select('full_name, email').eq('id', a.client_id).maybeSingle(),
    sb.from('services').select('name').eq('id', a.service_id).maybeSingle(),
  ]);
  const fmt = (t: string) => new Date(t).toLocaleString('en-US', { timeZone: st?.timezone || 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const when = fmt(a.starts_at);
  const byClient = a.cancelled_by === 'client';
  const name = c?.full_name || 'A client';
  const price = a.price != null ? ` · $${Number(a.price).toFixed(0)}` : '';
  const msg = ({
    booked: { title: `New booking: ${name}`, body: `${svc?.name ?? 'Haircut'} · ${when}${price}`, url: '/owner#calendar', tag: 'appt-' + a.id },
    manual: { title: `Booked: ${name}`, body: `${svc?.name ?? 'Haircut'} · ${when}${price} · tap to confirm it`, url: '/owner#schedule', tag: 'appt-' + a.id },
    confirmed: { title: `Confirmed: ${name}`, body: `${svc?.name ?? 'Haircut'} · ${when}`, url: '/owner#schedule', tag: 'appt-' + a.id },
    cancelled: { title: byClient ? `Cancelled: ${name}` : `You cancelled ${name}`, body: `${when} is open again${a.cancel_reason ? ` · "${String(a.cancel_reason).slice(0, 80)}"` : ''}`, url: '/owner#calendar', tag: 'appt-' + a.id },
    moved: { title: `Rescheduled: ${name}`, body: `${payload.old_record?.starts_at ? fmt(payload.old_record.starts_at) + ' → ' : ''}${when}`, url: '/owner#schedule', tag: 'appt-' + a.id },
  } as Record<string, Record<string, string>>)[kind];
  const pref: Record<string, string> = { booked: 'notify_bookings', manual: 'notify_manual', confirmed: 'notify_confirms', cancelled: 'notify_cancels', moved: 'notify_cancels' };

  // who gets it: owner/manager see everything, employees only their own chair
  const { data: subs } = await sb.from('push_subscriptions').select('*, profiles!inner(role, staff_id, active)').eq('profiles.active', true);
  const want = (subs ?? []).filter((s: any) => s[pref[kind]] !== false
    && (s.profiles.role !== 'employee' || s.profiles.staff_id === a.staff_id));
  const sent = await sendAll(sb, want, msg);
  // email only for client bookings and cancellations; your own bookings and confirmations are phone-only
  const emailOn = kind === 'booked' ? st?.email_bookings : kind === 'cancelled' && byClient ? st?.email_cancels : false;
  const emailed = emailOn !== false ? await sendEmail(st?.notify_email, msg, req) : 'off';
  // the client's own copy (never blocks or fails the owner alert)
  let clientEmail = 'off';
  if (st?.email_clients !== false && kind !== 'confirmed') {
    try { clientEmail = await sendClientEmail(kind, a, c, svc?.name ?? 'Haircut', st, payload.old_record?.starts_at ? fmt(payload.old_record.starts_at) : ''); }
    catch (e: any) { clientEmail = 'failed: ' + String(e?.message || e).slice(0, 160); }
  }
  return json({ kind, sent, devices: want.length, emailed, clientEmail });
});

const lastErrors: string[] = [];
async function sendAll(sb: any, subs: any[], msg: Record<string, string>) {
  let sent = 0; lastErrors.length = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(msg), { TTL: 3600, urgency: 'high' });
      sent++; await sb.from('push_subscriptions').update({ last_ok_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e: any) {
      lastErrors.push(`${e?.statusCode ?? ''} ${String(e?.body || e?.message || e).slice(0, 160)}`.trim());
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

// Confirmation / change / cancellation email to the client. Needs EMAIL_FROM on a domain
// verified in Resend: the shared onboarding@resend.dev sender can't deliver to clients.
async function sendClientEmail(kind: string, a: any, c: any, service: string, st: any, oldWhen: string) {
  const key = env('RESEND_API_KEY'); const from = env('EMAIL_FROM');
  if (!key) return 'no RESEND_API_KEY secret';
  if (!from || /resend\.dev/i.test(from)) return 'no EMAIL_FROM on your own domain yet';
  const to = String(c?.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return 'client gave no email';
  const tz = st?.timezone || 'America/Denver';
  const day = new Date(a.starts_at).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
  const t = (x: string) => new Date(x).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const time = `${t(a.starts_at)} – ${t(a.ends_at)}`;
  const first = String(c?.full_name || '').trim().split(' ')[0] || 'there';
  const site = String(st?.site_url || env('SITE_URL') || 'https://www.lopezcuts.com').replace(/\/+$/, '');
  const link = `${site}/#manage-${a.manage_token}`;
  const biz = st?.business_name || 'Lopez Cuts';
  const price = a.price != null ? `$${Number(a.price).toFixed(0)}` : '';
  const esc = (x: string) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const byClient = a.cancelled_by === 'client';
  const copy = ({
    booked: { subject: `You're booked: ${day} at ${t(a.starts_at)}`, head: `You're booked, ${first}!`, lead: 'Here are your appointment details.', btn: 'View or change my booking', href: link },
    manual: { subject: `You're booked: ${day} at ${t(a.starts_at)}`, head: `You're booked, ${first}!`, lead: 'Miguel added this appointment for you. Here are the details.', btn: 'View or change my booking', href: link },
    moved: { subject: `New time: ${day} at ${t(a.starts_at)}`, head: 'Your appointment moved', lead: oldWhen ? `It was ${oldWhen}. Here is your new time.` : 'Here is your new time.', btn: 'View or change my booking', href: link },
    reminder: { subject: `Reminder: your cut is ${day} at ${t(a.starts_at)}`, head: `See you soon, ${first}!`, lead: 'A quick reminder about your appointment.', btn: 'View or change my booking', href: link },
    cancelled: { subject: `Cancelled: ${day} at ${t(a.starts_at)}`, head: 'Your appointment was cancelled', lead: byClient ? 'You cancelled this appointment. Book a new time whenever you\'re ready.' : `Sorry, Miguel had to cancel this appointment.${a.cancel_reason ? ' Note: ' + String(a.cancel_reason).slice(0, 200) : ''}`, btn: 'Book a new time', href: site + '/#book' },
  } as Record<string, Record<string, string>>)[kind];
  if (!copy) return 'off';
  const rows = [['When', `${day}, ${time}`], ['Service', service], ...(price && kind !== 'cancelled' ? [['Price', `${price} (pay after your cut)`]] : []), ['Where', 'Salt Lake City, UT. Miguel texts you the address the morning of.']];
  const foot = kind === 'cancelled' ? '' : 'Need to change or cancel? Use the button above up to ' + (st?.cancel_cutoff_hours ?? 6) + ' hours before your appointment. You can also check your time anytime at ' + site + '/#appointment with your mobile number and first name.';
  const text = `${copy.head}\n${copy.lead}\n\n${rows.map((r) => `${r[0]}: ${r[1]}`).join('\n')}\n\n${copy.btn}: ${copy.href}\n\n${foot}\n\n${biz}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111;max-width:520px">
<p style="font-size:22px;margin:0 0 4px"><b>${esc(copy.head)}</b></p>
<p style="margin:0 0 16px;color:#444">${esc(copy.lead)}</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 18px">${rows.map((r) => `<tr><td style="padding:8px 12px 8px 0;color:#666;vertical-align:top;white-space:nowrap">${esc(r[0])}</td><td style="padding:8px 0"><b>${esc(r[1])}</b></td></tr>`).join('')}</table>
<p style="margin:0 0 18px"><a href="${esc(copy.href)}" style="background:#d4b46a;color:#111;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">${esc(copy.btn)}</a></p>
${foot ? `<p style="margin:0 0 14px;color:#666;font-size:14px">${esc(foot)}</p>` : ''}
<p style="margin:0;color:#666;font-size:14px">${esc(biz)} · Instagram @lopezcuts.dmv</p></div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], reply_to: st?.notify_email || undefined, subject: copy.subject, text, html }),
  });
  if (r.ok) return 'sent';
  const j = await r.json().catch(() => ({}));
  return 'failed: ' + String(j.message ?? r.statusText).slice(0, 200);
}
