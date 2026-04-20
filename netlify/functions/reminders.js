// netlify/functions/reminders.js
// Scheduled function — runs daily at 7am AEST (9pm UTC)
// Checks settlement_conditions for upcoming/overdue items and sends reminder emails via Resend
// Deduplicates using Upstash Redis so each reminder fires exactly once

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
  const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'settlements@getkredit.ai';
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const APP_URL = process.env.APP_URL || 'https://getkredit.ai';

  // ── Upstash Redis helper ─────────────────────────────────────────────────
  async function redisGet(key) {
    const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
    const data = await res.json();
    return data.result;
  }

  async function redisSet(key, value, exSeconds) {
    await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${exSeconds}`, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    });
  }

  // ── Send email via Resend ────────────────────────────────────────────────
  async function sendEmail(to, subject, html) {
    const recipients = [to];
    if (ADMIN_EMAIL && ADMIN_EMAIL !== to) recipients.push(ADMIN_EMAIL);

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: `getkredit.ai <${FROM_EMAIL}>`,
        to: recipients,
        subject,
        html
      })
    });
  }

  // ── Email template ───────────────────────────────────────────────────────
  function buildEmail(condition, daysUntil) {
    const isOverdue = daysUntil < 0;
    const daysAbs = Math.abs(daysUntil);
    const statusColor = isOverdue ? '#dc2626' : daysUntil <= 1 ? '#d97706' : '#0D9488';
    const statusText = isOverdue
      ? `OVERDUE by ${daysAbs} day${daysAbs !== 1 ? 's' : ''}`
      : daysUntil === 0 ? 'DUE TODAY'
      : `Due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}`;

    const subject = isOverdue
      ? `OVERDUE: ${condition.condition_text.substring(0, 60)}… — ${condition.deal_name}`
      : `Reminder: ${statusText} — ${condition.deal_name}`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">

  <!-- Header -->
  <tr><td style="background:#0F172A;padding:24px 32px">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:white">
      get<span style="color:#14B8A6">kredit.ai</span>
    </div>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px">Settlement Workflow</div>
  </td></tr>

  <!-- Status banner -->
  <tr><td style="background:${statusColor};padding:14px 32px">
    <div style="font-size:13px;font-weight:700;color:white;letter-spacing:0.5px">${statusText}</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:28px 32px">
    <div style="font-size:13px;color:#64748b;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600">Deal</div>
    <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:4px">${condition.deal_name || 'N/A'}</div>
    <div style="font-size:13px;color:#64748b;margin-bottom:24px">${condition.deal_address || ''}</div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:24px">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:8px">${condition.stage_name}</div>
      <div style="font-size:14px;color:#0f172a;line-height:1.6">${condition.condition_text}</div>
      <div style="margin-top:10px;display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${statusColor}20;color:${statusColor}">
        Due: ${condition.due_date}
      </div>
    </div>

    <a href="${APP_URL}/settlement.html?deal=${condition.deal_id}" 
       style="display:inline-block;padding:12px 24px;background:#0D9488;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">
      View Settlement Checklist →
    </a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;background:#f8fafc">
    <div style="font-size:11px;color:#94a3b8">
      This is an automated reminder from getkredit.ai. 
      ${condition.broker_name ? `Sent to ${condition.broker_name}.` : ''}
      To stop reminders, mark this condition as complete in the settlement checklist.
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

    return { subject, html };
  }

  // ── Main logic ───────────────────────────────────────────────────────────
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Fetch all pending conditions with due dates
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/settlement_conditions?status=eq.pending&due_date=not.is.null&order=due_date.asc`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    const conditions = await res.json();
    if (!res.ok) throw new Error('Supabase fetch failed');

    let sent = 0;
    const results = [];

    for (const condition of conditions) {
      if (!condition.broker_email && !ADMIN_EMAIL) continue;

      const dueDate = new Date(condition.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.round((dueDate - today) / (1000 * 60 * 60 * 24));

      // Determine which reminder window we're in
      let reminderKey = null;
      let supabaseFlag = null;

      if (daysUntil === 7 && !condition.reminded_7d) {
        reminderKey = `remind_7d_${condition.id}`;
        supabaseFlag = 'reminded_7d';
      } else if (daysUntil === 3 && !condition.reminded_3d) {
        reminderKey = `remind_3d_${condition.id}`;
        supabaseFlag = 'reminded_3d';
      } else if (daysUntil <= 1 && daysUntil >= 0 && !condition.reminded_1d) {
        reminderKey = `remind_1d_${condition.id}`;
        supabaseFlag = 'reminded_1d';
      } else if (daysUntil < 0 && !condition.reminded_overdue) {
        reminderKey = `remind_overdue_${condition.id}_${todayStr}`;
        supabaseFlag = 'reminded_overdue';
      }

      if (!reminderKey) continue;

      // Dedup check via Upstash
      const alreadySent = await redisGet(reminderKey);
      if (alreadySent) continue;

      // Build and send email
      const { subject, html } = buildEmail(condition, daysUntil);
      const recipient = condition.broker_email || ADMIN_EMAIL;
      await sendEmail(recipient, subject, html);

      // Mark in Redis (expire after 8 days)
      await redisSet(reminderKey, '1', 8 * 24 * 60 * 60);

      // Mark in Supabase
      const updatePayload = { [supabaseFlag]: true, updated_at: new Date().toISOString() };
      await fetch(
        `${SUPABASE_URL}/rest/v1/settlement_conditions?id=eq.${condition.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          body: JSON.stringify(updatePayload)
        }
      );

      sent++;
      results.push({ id: condition.id, condition_text: condition.condition_text.substring(0, 60), daysUntil, recipient });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, processed: conditions.length, sent, results })
    };

  } catch (err) {
    console.error('Reminders error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
