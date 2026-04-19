// Netlify serverless function — AI Document Reader
// Accepts PDF as base64, extracts structured deal data + generates credit narrative
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Not allowed' };

  try {
    const { fileBase64, fileType, docType, existingData } = JSON.parse(event.body);

    if (!fileBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file provided' }) };
    }

    // Determine media type
    const mediaType = fileType === 'pdf' ? 'application/pdf' : 
                      fileType === 'png' ? 'image/png' :
                      fileType === 'jpg' || fileType === 'jpeg' ? 'image/jpeg' : 'application/pdf';

    const systemPrompt = `You are an expert commercial real estate credit analyst working for getkredit.ai, an Australian development finance marketplace. 

Your job is to read uploaded documents (valuations, financial statements, QS reports, loan summaries) and extract structured data that will populate a development finance Funding Request.

IMPORTANT CONTEXT:
- All monetary values are in AUD
- This is Australian property development finance
- Common metrics: GRV (Gross Realisable Value), LVR (Loan to Value Ratio), LTC (Loan to Cost), TDC (Total Development Cost)
- Document type being analysed: ${docType || 'auto-detect'}

${existingData ? `EXISTING DEAL DATA (merge with, don't overwrite unless the document has more accurate info):
${JSON.stringify(existingData, null, 2)}` : ''}

You MUST respond with ONLY valid JSON — no markdown, no backticks, no preamble. The JSON must have this exact structure:

{
  "docType": "valuation|financial_statement|qs_report|loan_summary|other",
  "confidence": 0.0 to 1.0,
  "extractedFields": {
    "borrowerName": "string or null",
    "entityName": "string or null",
    "address": "string or null",
    "landArea": "number or null (sqm)",
    "landValue": "number or null",
    "daValue": "number or null",
    "units": "number or null",
    "avgPrice": "number or null",
    "grv": "number or null (Gross Realisable Value)",
    "constructionCost": "number or null",
    "totalDevCost": "number or null",
    "loanAmount": "number or null",
    "existingDebt": "number or null",
    "presalesValue": "number or null",
    "presalesCount": "number or null",
    "netIncome": "number or null",
    "totalAssets": "number or null",
    "totalLiabilities": "number or null",
    "netWorth": "number or null",
    "occupancy": "number or null (as decimal 0-1)",
    "rentalIncome": "number or null (annual)",
    "constructionTerm": "string or null",
    "builder": "string or null",
    "architect": "string or null",
    "daStatus": "string or null",
    "zoning": "string or null",
    "unitBreakdown": [{"type":"string","beds":"number","size":"number sqm","price":"number"}] 
  },
  "narrative": "A 2-3 paragraph professional credit submission narrative summarising the deal based on the document. Written in third person, formal tone, suitable for a lender credit committee. Include key metrics, strengths, and any flags.",
  "flags": ["array of any concerns, missing info, or items requiring attention"],
  "summary": "One sentence plain English summary of what this document tells us"
}

Only include fields where you can extract data with reasonable confidence. Set others to null.
For the narrative, write as if presenting to a bank credit committee — professional, concise, data-driven.`;

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: fileBase64
            }
          },
          {
            type: 'text',
            text: `Please analyse this ${docType || 'document'} and extract all relevant development finance data. Return ONLY the JSON object as specified.`
          }
        ]
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
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await res.json();
    if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };

    // Extract the text response and parse JSON
    const textContent = data.content.find(c => c.type === 'text');
    if (!textContent) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'No text response from AI' }) };
    }

    // Clean and parse
    let jsonText = textContent.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
      // If parsing fails, return raw text for debugging
      return { statusCode: 200, headers, body: JSON.stringify({ 
        raw: textContent.text, 
        parseError: parseErr.message,
        extractedFields: {},
        narrative: textContent.text,
        flags: ['AI response could not be parsed as structured data'],
        summary: 'Document was read but structured extraction failed. Review the raw output.'
      })};
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
