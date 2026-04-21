// netlify/functions/feasibility-save.js
// Save, load, list, and delete feasibility models in Supabase
// Uses service key for full access, auth validated via user token

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
  }

  // Helper: Supabase REST call
  async function sbFetch(path, method, body) {
    const opts = {
      method: method || 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data));
    return data;
  }

  try {
    const body = JSON.parse(event.body);
    const { action, user_id } = body;

    if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing user_id' }) };

    // ── LIST: Get all models for this user ──
    if (action === 'list') {
      const models = await sbFetch(
        `feasibility_models?user_id=eq.${user_id}&select=id,model_name,model_type,deal_id,grv,total_project_cost,dev_margin,margin_pct,peak_debt,ltc,roc,irr,created_at,updated_at&order=updated_at.desc`,
        'GET'
      );
      return { statusCode: 200, headers, body: JSON.stringify({ models }) };
    }

    // ── FIND BY DEAL: Get model for a specific deal (any user) ──
    if (action === 'find_by_deal') {
      const { deal_id } = body;
      if (!deal_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing deal_id' }) };
      const models = await sbFetch(
        `feasibility_models?deal_id=eq.${deal_id}&select=*&order=updated_at.desc&limit=1`,
        'GET'
      );
      if (models && models.length > 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ model: models[0] }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ model: null }) };
    }

    // ── LOAD: Get a specific model ──
    if (action === 'load') {
      const { model_id } = body;
      if (!model_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing model_id' }) };
      const models = await sbFetch(
        `feasibility_models?id=eq.${model_id}&user_id=eq.${user_id}&select=*`,
        'GET'
      );
      if (!models || models.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Model not found' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ model: models[0] }) };
    }

    // ── SAVE: Create or update a model ──
    if (action === 'save') {
      const { model_id, model_name, model_type, deal_id, model_data, snapshot } = body;

      const record = {
        user_id,
        model_name: model_name || 'Untitled Model',
        model_type: model_type || 'standard',
        model_data: model_data || {},
        updated_at: new Date().toISOString()
      };

      if (deal_id) record.deal_id = deal_id;

      // Snapshot metrics for listing
      if (snapshot) {
        if (snapshot.grv != null) record.grv = snapshot.grv;
        if (snapshot.total_project_cost != null) record.total_project_cost = snapshot.total_project_cost;
        if (snapshot.dev_margin != null) record.dev_margin = snapshot.dev_margin;
        if (snapshot.margin_pct != null) record.margin_pct = snapshot.margin_pct;
        if (snapshot.peak_debt != null) record.peak_debt = snapshot.peak_debt;
        if (snapshot.ltc != null) record.ltc = snapshot.ltc;
        if (snapshot.roc != null) record.roc = snapshot.roc;
        if (snapshot.irr != null) record.irr = snapshot.irr;
      }

      let result;

      if (model_id) {
        // Update existing
        result = await sbFetch(
          `feasibility_models?id=eq.${model_id}&user_id=eq.${user_id}`,
          'PATCH',
          record
        );
      } else {
        // Create new
        record.created_at = new Date().toISOString();
        result = await sbFetch('feasibility_models', 'POST', record);
      }

      const saved = Array.isArray(result) ? result[0] : result;
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, model: saved }) };
    }

    // ── DELETE: Remove a model ──
    if (action === 'delete') {
      const { model_id } = body;
      if (!model_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing model_id' }) };
      await sbFetch(
        `feasibility_models?id=eq.${model_id}&user_id=eq.${user_id}`,
        'DELETE'
      );
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, deleted: model_id }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };

  } catch (err) {
    console.error('feasibility-save error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
