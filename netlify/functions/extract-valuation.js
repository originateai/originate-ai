// netlify/functions/extract-valuation.js
// Accepts: {images: [base64,...], fileType:'images'} OR {fileBase64, fileType}
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
    const { images, fileBase64, fileType } = body;

    const system = `You are an expert Australian property valuer. Extract ALL units/lots/properties from these pages. Return ONLY valid JSON, no markdown fences:
{"projectName":"string","address":"string","borrowerName":"string","valuationDate":"YYYY-MM-DD","units":[{"lot":"string","address":"string","area":0,"bedrooms":"","bathrooms":"","parking":"","internalArea":0,"valuation":0,"valuationExGST":0,"unitType":"string","notes":""}],"summary":"string"}
unitType: 1-Bed Apartment, 2-Bed Apartment, 3-Bed Apartment, Studio, Townhouse, Villa, Duplex, House & Land, Penthouse, Commercial, Retail, Industrial, Medical, Land Lot, Strata Unit.
Valuations as numbers in AUD. Only extract what exists in the document. If no units found, return {"units":[]}.`;

    // Build content array
    let content = [];

    if (images && images.length > 0) {
      // Multiple page images
      images.forEach(img => {
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
      });
    } else if (fileBase64) {
      // Single file
      const isImage = ['png','jpg','jpeg','gif','webp'].includes(fileType);
      const mediaType = fileType === 'pdf' ? 'application/pdf'
        : fileType === 'png' ? 'image/png'
        : (fileType === 'jpg' || fileType === 'jpeg') ? 'image/jpeg'
        : 'application/pdf';
      content.push({
        type: isImage ? 'image' : 'document',
        source: { type: 'base64', media_type: mediaType, data: fileBase64 }
      });
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file data' }) };
    }

    content.push({ type: 'text', text: 'Extract all unit/lot details from these valuation pages. Return JSON only.' });

    console.log('Sending to Claude:', content.length - 1, 'images/docs');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        system: system,
        messages: [{ role: 'user', content: content }]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 500));
      return { statusCode: 500, headers, body: JSON.stringify({ error: data.error ? data.error.message : 'AI failed' }) };
    }

    let text = data.content && data.content[0] ? data.content[0].text : '';
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { statusCode: 200, headers, body: JSON.stringify({ error: 'Could not parse response', raw: text.substring(0, 1000) }) }; }

    console.log('Extracted', parsed.units ? parsed.units.length : 0, 'units');
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: parsed }) };

  } catch (err) {
    console.error('extract-valuation error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
