// Netlify serverless function — Save deal to Supabase
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Not allowed' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    // ── SAVE DEAL ──
    if (action === 'save_deal') {
      const { deal } = body;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/deals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(deal)
      });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, deal: data[0] }) };
    }

    // ── UPDATE DEAL ──
    if (action === 'update_deal') {
      const { dealId, updates } = body;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${dealId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, deal: data[0] }) };
    }

    // ── SAVE LENDER MATCHES ──
    if (action === 'save_matches') {
      const { matches } = body;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lender_matches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(matches)
      });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, matches: data }) };
    }

    // ── GET LENDERS (for matching) ──
    if (action === 'get_lenders') {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lenders?status=eq.Active&select=*,lender_rates(*),lender_lvr_matrix(*),lender_presales(*),lender_geography(*),lender_serviceability(*),lender_credit(*)`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      const data = await res.json();
      if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, lenders: data }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
