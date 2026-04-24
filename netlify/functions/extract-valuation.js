// netlify/functions/extract-valuation.js
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };

  try {
    const body = JSON.parse(event.body);
    const { fileBase64, fileType } = body;
    if (!fileBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file data' }) };

    const isImage = ['png','jpg','jpeg','gif','webp'].includes(fileType);
    const mediaType = fileType === 'pdf' ? 'application/pdf'
      : fileType === 'png' ? 'image/png'
      : (fileType === 'jpg' || fileType === 'jpeg') ? 'image/jpeg'
      : 'application/pdf';

    const system = `You are an expert Australian property valuer. Extract ALL units/lots/properties from this document. Return ONLY valid JSON, no markdown fences. Structure:
{"projectName":"string","valuationDate":"YYYY-MM-DD","units":[{"lot":"string","address":"string","area":0,"bedrooms":"","bathrooms":"","parking":"","internalArea":0,"valuation":0,"valuationExGST":0,"unitType":"string","notes":""}],"summary":"string"}
unitType must be one of: 1-Bed Apartment, 2-Bed Apartment, 3-Bed Apartment, Studio, Townhouse, Villa, Duplex, House & Land, Penthouse, Commercial, Retail, Industrial, Medical, Land Lot, Strata Unit.
Valuations as numbers in AUD. Only extract what is in the document.`;

    const contentBlock = isImage
      ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: fileBase64 } }
      : { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileBase64 } };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: system,
        messages: [{ role: 'user', content: [
          contentBlock,
          { type: 'text', text: 'Extract all unit/lot details. Return JSON only.' }
        ]}]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic error:', JSON.stringify(data));
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI failed', detail: data.error ? data.error.message : JSON.stringify(data) }) };
    }

    let text = data.content && data.content[0] ? data.content[0].text : '';
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not parse AI response', raw: text.substring(0, 500) }) }; }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: parsed }) };

  } catch (err) {
    console.error('extract-valuation error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
