// netlify/functions/abn-lookup.js
// Proxies ABN Lookup API — keeps GUID server-side
// Supports: search by name, search by ABN, search by ACN

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Not allowed' };

  const GUID = process.env.ABN_LOOKUP_GUID;
  if (!GUID) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ABN Lookup not configured' }) };

  try {
    const { query, type } = JSON.parse(event.body);
    if (!query) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No query provided' }) };

    let url, results = [];

    // Clean query
    const clean = query.replace(/\s/g, '');
    const isABN = /^\d{11}$/.test(clean);
    const isACN = /^\d{9}$/.test(clean);

    if (isABN || type === 'abn') {
      // Search by ABN
      url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${clean}&callback=callback&guid=${GUID}`;
      const res = await fetch(url);
      const text = await res.text();
      const json = JSON.parse(text.replace(/^callback\(/, '').replace(/\)$/, ''));

      if (json.Abn) {
        results = [{
          abn: json.Abn,
          acn: json.Acn || null,
          name: json.EntityName || json.BusinessName?.[0]?.OrganisationName || '',
          type: json.EntityTypeName || '',
          status: json.AbnStatus || '',
          gst: json.Gst || '',
          state: json.BusinessAddress?.State || '',
          postcode: json.BusinessAddress?.Postcode || ''
        }];
      }

    } else if (isACN || type === 'acn') {
      // Search by ACN
      url = `https://abr.business.gov.au/json/AcnDetails.aspx?acn=${clean}&callback=callback&guid=${GUID}`;
      const res = await fetch(url);
      const text = await res.text();
      const json = JSON.parse(text.replace(/^callback\(/, '').replace(/\)$/, ''));

      if (json.Abn) {
        results = [{
          abn: json.Abn,
          acn: json.Acn || clean,
          name: json.EntityName || json.BusinessName?.[0]?.OrganisationName || '',
          type: json.EntityTypeName || '',
          status: json.AbnStatus || '',
          gst: json.Gst || '',
          state: json.BusinessAddress?.State || '',
          postcode: json.BusinessAddress?.Postcode || ''
        }];
      }

    } else {
      // Search by name
      url = `https://abr.business.gov.au/json/MatchingNames.aspx?name=${encodeURIComponent(query)}&maxResults=10&callback=callback&guid=${GUID}`;
      const res = await fetch(url);
      const text = await res.text();
      const json = JSON.parse(text.replace(/^callback\(/, '').replace(/\)$/, ''));

      if (json.Names) {
        results = json.Names.map(function(n) {
          return {
            abn: n.Abn,
            acn: null,
            name: n.Name || '',
            type: n.Type || '',
            status: n.Status || '',
            state: n.State || '',
            postcode: n.Postcode || ''
          };
        });
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ results }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
