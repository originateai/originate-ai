// netlify/functions/extract-valuation.js
// AI extraction of unit details from valuation PDFs, spreadsheets, images
// Uses Claude to extract lot numbers, addresses, areas, valuations, unit types

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Not allowed' };

  try {
    const { fileBase64, fileType } = JSON.parse(event.body);
    if (!fileBase64) return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file provided' }) };
    if (fileBase64.length > 26000000) return { statusCode: 400, headers, body: JSON.stringify({ error: 'File too large. Maximum 15MB.' }) };

    const mediaType = fileType === 'pdf' ? 'application/pdf'
      : fileType === 'png' ? 'image/png'
      : fileType === 'jpg' || fileType === 'jpeg' ? 'image/jpeg'
      : fileType === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

    const system = `You are an expert Australian property valuer and finance analyst. You are reading a valuation report, unit schedule, or property listing document.

Extract ALL individual lots/units/properties from the document. For each unit, extract as much detail as possible.

Return ONLY valid JSON with no markdown or backticks. Use this exact structure:
{
  "projectName": "string or null",
  "projectAddress": "string or null",
  "valuer": "string or null",
  "valuationDate": "YYYY-MM-DD or null",
  "totalUnits": 0,
  "units": [
    {
      "lot": "lot/unit number as string",
      "address": "street address",
      "area": 0,
      "areaUnit": "sqm",
      "bedrooms": "",
      "bathrooms": "",
      "parking": "",
      "internalArea": 0,
      "valuation": 0,
      "valuationExGST": 0,
      "unitType": "one of: 1-Bed Apartment, 2-Bed Apartment, 3-Bed Apartment, Studio, Townhouse, Villa, Duplex, House & Land, Penthouse, Commercial, Retail, Industrial, Medical, Land Lot, Strata Unit",
      "notes": ""
    }
  ],
  "summary": "one sentence summary of the valuation"
}

Rules:
- Extract every unit/lot/property you can find
- Valuations should be in AUD as numbers (no $ signs or commas)
- If GST-inclusive and GST-exclusive values are both shown, include both
- If only one valuation is shown, put it in "valuation" and set valuationExGST to 0
- Areas should be in square metres as numbers
- For lot/address, use exactly what's in the document
- unitType should be the closest match from the list provided
- If you can't determine a field, use empty string or 0
- Do NOT make up data — only extract what's actually in the document`;

    const content = [
      {
        type: mediaType.startsWith('image') ? 'image' : 'document',
        source: { type: 'base64', media_type: mediaType, data: fileBase64 }
      },
      {
        type: 'text',
        text: 'Extract all unit/lot details from this valuation document. Return JSON only.'
      }
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: system,
        messages: [{ role: 'user', content: content }]
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('Anthropic error:', data);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI extraction failed', detail: data }) };
    }

    let text = data.content && data.content[0] ? data.content[0].text : '';
    // Clean markdown fences if present
    text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ raw: text, error: 'Could not parse AI response as JSON' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, data: parsed })
    };

  } catch (err) {
    console.error('extract-valuation error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
