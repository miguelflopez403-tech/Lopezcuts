// Lopezcuts: sends queued texts (sms_outbox) through Twilio.
//
// Called by the Supabase Database Webhook on sms_outbox INSERT (see TEXTS-SETUP.md).
// It only ever sends rows that the database itself queued, so calling it can't
// send arbitrary messages. Secrets live in Supabase → Edge Functions → Secrets:
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either
//   TWILIO_MESSAGING_SERVICE_SID (recommended) or TWILIO_FROM (+1XXXXXXXXXX).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const env = (k: string) => Deno.env.get(k) ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

  // Only send when the dashboard is set to Automatic. In manual mode the texts
  // stay on the Today page for Miguel to send from his phone.
  const { data: st } = await sb.from('settings').select('text_mode').eq('id', 1).maybeSingle();
  if (st?.text_mode !== 'auto') return Response.json({ results: {}, note: 'Texts are not set to Automatic.' });

  const payload = await req.json().catch(() => ({}));
  let ids: string[] = payload?.record?.id ? [payload.record.id] : [];
  if (!ids.length) {
    // No record given: sweep anything still queued from the last day.
    const { data } = await sb.from('sms_outbox').select('id').eq('status', 'queued')
      .gte('created_at', new Date(Date.now() - 864e5).toISOString()).limit(25);
    ids = (data ?? []).map((r) => r.id);
  }

  const sid = env('TWILIO_ACCOUNT_SID'), token = env('TWILIO_AUTH_TOKEN');
  const msgSvc = env('TWILIO_MESSAGING_SERVICE_SID'), from = env('TWILIO_FROM');
  const results: Record<string, string> = {};

  for (const id of ids) {
    // Claim the row so a retry can never send it twice.
    const { data: m } = await sb.from('sms_outbox').update({ status: 'sending' })
      .eq('id', id).eq('status', 'queued').select().maybeSingle();
    if (!m) { results[id] = 'skipped'; continue; }

    if (!sid || !token || (!msgSvc && !from)) {
      await sb.from('sms_outbox').update({ status: 'failed', error: 'Twilio is not connected yet (missing secrets).' }).eq('id', id);
      results[id] = 'failed'; continue;
    }
    const form = new URLSearchParams({ To: m.to_phone, Body: m.body });
    if (msgSvc) form.set('MessagingServiceSid', msgSvc); else form.set('From', from);
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        await sb.from('sms_outbox').update({ status: 'sent', provider_id: j.sid ?? null, sent_at: new Date().toISOString(), error: null }).eq('id', id);
        results[id] = 'sent';
      } else {
        await sb.from('sms_outbox').update({ status: 'failed', error: String(j.message ?? r.statusText).slice(0, 300) }).eq('id', id);
        results[id] = 'failed';
      }
    } catch (e) {
      await sb.from('sms_outbox').update({ status: 'failed', error: String(e).slice(0, 300) }).eq('id', id);
      results[id] = 'failed';
    }
  }
  return Response.json({ results });
});
