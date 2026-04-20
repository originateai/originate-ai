// netlify/functions/extract-conditions.js
// Reads a lender term sheet PDF and extracts:
// - All conditions precedent (with exact wording)
// - Financial close date (to auto-set due dates)
// - Facility type, borrower, lender, loan amount
// Returns structured conditions array ready to populate settlement checklist

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

    if (!fileBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No file provided' }) };
    }

    // Size check
    if (fileBase64.length > 26000000) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'PDF too large. Maximum 15MB.' }) };
    }

    const mediaType = fileType === 'pdf' ? 'application/pdf'
      : fileType === 'png' ? 'image/png'
      : fileType === 'jpg' || fileType === 'jpeg' ? 'image/jpeg'
      : 'application/pdf';

    const systemPrompt = `You are an expert Australian property finance lawyer and credit analyst reading a lender term sheet or letter of offer.

Your job is to extract EVERY condition precedent exactly as written, plus key deal terms, and return structured JSON.

EXTRACTION RULES:
1. Extract EVERY condition precedent / condition subsequent — use the exact wording from the document, do not paraphrase
2. Group conditions by their natural category (Board Approval, Valuation, Legal, Presales, Construction, Borrower Diligence, Fees, etc.)
3. Extract the Financial Close date — this is the master deadline, use it to suggest due dates for each condition (working backwards: board approval 2 days before FC, valuation 7 days before FC, legal docs 3 days before FC, etc.)
4. Detect facility type from Purpose/Type field: bridging, construction, commercial, land, btl
5. Extract all key commercial terms

Respond with ONLY valid JSON — no markdown, no backticks, no explanation:

{
  "dealSummary": {
    "lender": "string",
    "borrower": "string",
    "facilityType": "bridging|construction|commercial|land|btl",
    "purpose": "string",
    "facilityAmount": number or null,
    "lvr": number or null (as decimal e.g. 0.675),
    "interestRate": "string e.g. '10.50% p.a.' or 'BBSW + 5.25%'",
    "term": "string e.g. '18 months'",
    "financialCloseDate": "YYYY-MM-DD or null",
    "maturityDate": "YYYY-MM-DD or null",
    "securityAddress": "string or null",
    "establishmentFee": "string or null",
    "commitmentFee": "string or null"
  },
  "conditions": [
    {
      "stage": "string — natural group name e.g. 'Board & credit approval', 'Valuation & security', 'Legal documentation', 'Presales', 'Building contract', 'Borrower diligence', 'Fees & settlement'",
      "text": "exact condition text from document",
      "tag": "admin|legal|financial|property|construction",
      "requiresDocument": true or false,
      "docLabel": "short label for upload button e.g. 'Upload valuation' or null",
      "suggestedDueDaysBeforeFC": number or null — how many days before financial close this should be done
    }
  ],
  "flags": ["any concerns or unusual conditions worth noting"],
  "summary": "one sentence summary of the term sheet"
}

TAG RULES:
- admin: board approvals, KYC/AML, privacy consents, credit checks, commitment fees
- legal: mortgages, GSA, PPSR, guarantees, facility agreements, deeds
- financial: valuations, LVR confirmations, income evidence, financial statements, fees
- property: insurance, DA approvals, QS reports, building permits, title searches
- construction: building contract, presales, builder side deed, drawdown schedule

DOCUMENT REQUIREMENT RULES — set requiresDocument: true when the condition involves:
- Any valuation, report, or certificate
- Any executed legal document
- Any evidence, proof, or confirmation requiring a document
- Any insurance certificate
- Any financial statement or tax return
- Any presale contracts
Set requiresDocument: false for internal approvals, LVR calculations, or confirmations that don't need a physical document.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 6000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: mediaType, data: fileBase64 }
            },
            {
              type: 'text',
              text: 'Read this term sheet carefully. Extract EVERY condition precedent with exact wording. Group them logically. Set suggested due dates working backwards from the financial close date. Return only the JSON object.'
            }
          ]
        }]
      })
    });

    const data = await res.json();
    if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };

    const textContent = data.content.find(c => c.type === 'text');
    if (!textContent) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No response from AI' }) };

    let jsonText = textContent.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch(e) {
      return { statusCode: 200, headers, body: JSON.stringify({
        raw: textContent.text,
        parseError: e.message,
        conditions: [],
        dealSummary: {},
        flags: ['Could not parse structured response'],
        summary: 'Term sheet was read but extraction failed.'
      })};
    }

    return { statusCode: 200, headers, body: JSON.stringify(parsed) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
