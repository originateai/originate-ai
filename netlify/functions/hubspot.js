// Netlify serverless function — HubSpot proxy
// Token stored in Netlify environment variables — never in code

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Not allowed' };

  try {
    const b = JSON.parse(event.body);
    const HS = process.env.HUBSPOT_TOKEN;
    const L = { bridging: 'Bridging Finance', site: 'Site Acquisition', development: 'Development Finance' };
    const np = (b.name || '').trim().split(/\s+/);

    const cr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + HS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: {
        firstname: np[0] || '', lastname: np.slice(1).join(' ') || '',
        email: b.email || '', phone: b.phone || '', hs_lead_status: 'NEW'
      }})
    });

    let cId = null;
    if (cr.ok) { cId = (await cr.json()).id; }
    else if (cr.status === 409) {
      const sr = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + HS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: b.email }] }] })
      });
      if (sr.ok) { const sd = await sr.json(); if (sd.results?.length) cId = sd.results[0].id; }
    }

    const dr = await fetch('https://api.hubapi.com/crm/v3/objects/deals', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + HS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ properties: {
        dealname: (b.name || 'Unknown') + ' - ' + (L[b.loanType] || 'Loan Enquiry'),
        dealstage: 'appointmentscheduled', pipeline: 'default',
        amount: String(b.loanAmount || 0).replace(/[^0-9.]/g, ''),
        description: 'Type: ' + (L[b.loanType] || b.loanType) + '\nAddress: ' + (b.address || '-') + '\nLVR: ' + (b.lvr || '-') + '\nPOC: ' + (b.poc || '-') + '\nFacility: ' + (b.facility || '-'),
        closedate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
      }})
    });

    let dId = null;
    if (dr.ok) {
      dId = (await dr.json()).id;
      if (cId && dId) await fetch('https://api.hubapi.com/crm/v3/objects/deals/' + dId + '/associations/contacts/' + cId + '/deal_to_contact', {
        method: 'PUT', headers: { 'Authorization': 'Bearer ' + HS }
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, contactId: cId, dealId: dId }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
