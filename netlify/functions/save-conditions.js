// netlify/functions/save-conditions.js
// Saves settlement conditions + due dates to Supabase

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Not allowed' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    // ── UPSERT CONDITIONS ──────────────────────────────────────────────────
    if (action === 'upsert_conditions') {
      const { conditions } = body;
      // conditions = array of { deal_id, condition_id, condition_text, facility_type,
      //   stage_name, status, due_date, broker_email, broker_name, admin_email,
      //   deal_name, deal_address }

      const res = await fetch(`${SUPABASE_URL}/rest/v1/settlement_conditions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(conditions)
      });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    // ── UPDATE SINGLE CONDITION ────────────────────────────────────────────
    if (action === 'update_condition') {
      const { deal_id, condition_id, updates } = body;
      if (updates.status === 'complete' && !updates.completed_at) {
        updates.completed_at = new Date().toISOString();
      }
      updates.updated_at = new Date().toISOString();

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/settlement_conditions?deal_id=eq.${deal_id}&condition_id=eq.${condition_id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(updates)
        }
      );
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, data }) };
    }

    // ── GET CONDITIONS FOR DEAL ────────────────────────────────────────────
    if (action === 'get_conditions') {
      const { deal_id } = body;
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/settlement_conditions?deal_id=eq.${deal_id}&order=created_at.asc`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        }
      );
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, conditions: data }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
