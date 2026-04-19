// Netlify serverless function — AI Document Reader
// V2: Full commercial asset-type awareness — cap val, income, BTL adjustments
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

    const mediaType = fileType === 'pdf' ? 'application/pdf' : 
                      fileType === 'png' ? 'image/png' :
                      fileType === 'jpg' || fileType === 'jpeg' ? 'image/jpeg' : 'application/pdf';

    const systemPrompt = `You are an expert commercial real estate credit analyst working for getkredit.ai, an Australian development finance and commercial property marketplace.

Your job is to read uploaded documents (valuations, financial statements, QS reports, loan summaries) and extract structured data that will populate a Funding Request.

CRITICAL — ASSET TYPE DETECTION:
You MUST first determine the asset type from the document content. This determines which fields matter:

1. COMMERCIAL — INVESTMENT (income-producing asset with tenant):
   Indicators: lease agreement, tenant name, passing rent, cap rate, net income, "as if complete" valuation, commercial zoning (B/E/IN zones), property types like service station, retail, office, industrial, medical, childcare, hotel/pub.
   Valuation: CAPITALISATION METHOD — gross income > outgoings > net income > cap rate > capitalised value > BTL adjustments > adopted value.
   MUST extract: grossIncome, outgoings breakdown, capRate, netIncome, capitalisedValue, BTL adjustments, adoptedValue, tenant details, lease terms.
   Do NOT treat as residential — do NOT focus on units/avgPrice.

2. RESIDENTIAL — DEVELOPMENT (multi-unit residential project):
   Indicators: number of units/lots, individual unit prices, presales, residential zoning (R zones), townhouses/apartments/duplex/subdivision.
   Valuation: DIRECT COMPARISON / SUMMATION — units x average price = GRV.
   MUST extract: units, avgPrice, grv, presales, unitBreakdown.

3. COMMERCIAL — DEVELOPMENT (ground-up commercial build):
   Indicators: DA for commercial use, construction of commercial premises.
   Hybrid: may have both construction costs AND income projections.

4. LAND — ACQUISITION:
   Indicators: vacant land, no improvements.
   Extract: landValue, landArea, zoning, DA status.

IMPORTANT CONTEXT:
- All monetary values in AUD. Australian property terminology.
- Common metrics: GRV, LVR, LTC, TDC, WALE, NOI
- For commercial valuations: the valuer's adopted cap rate and BTL adjustments are critical
- Document type: ${docType || 'auto-detect'}

${existingData ? `EXISTING DEAL DATA (merge with, don't overwrite unless document is more accurate):
${JSON.stringify(existingData, null, 2)}` : ''}

Respond with ONLY valid JSON — no markdown, no backticks, no preamble:

{
  "docType": "valuation|financial_statement|qs_report|loan_summary|other",
  "assetType": "commercial_investment|commercial_dev|resi_dev|resi_investment|land|mixed_use",
  "propertySubtype": "service_station|retail_single|retail_multi|office_single|office_multi|industrial|medical|childcare|hospitality|mixed_use|townhouses|apartments|duplex|land_subdivision|house_and_land|other",
  "valuationMethod": "capitalisation|direct_comparison|summation|hypothetical_development|residual|other",
  "confidence": 0.0 to 1.0,
  "extractedFields": {
    "borrowerName": "string or null",
    "entityName": "string or null",
    "address": "string or null",
    "landArea": "number or null (sqm)",
    "landValue": "number or null",
    "zoning": "string or null",
    "daStatus": "string or null",

    "tenantName": "string or null",
    "tenantCovenant": "string or null — e.g. 'ASX-listed', 'National tenant'",
    "leaseTermTotal": "number or null (years)",
    "leaseTermRemaining": "number or null (years)",
    "leaseStructure": "string or null — 'net', 'gross', 'semi_gross'",
    "optionTerms": "string or null — e.g. '3 x 5-year options'",
    "reviewType": "string or null — 'fixed', 'cpi', 'market', 'greater_of'",
    "reviewRate": "number or null (annual %)",
    "grossIncome": "number or null (annual passing rent)",
    "marketRent": "number or null (annual market rent)",
    "vacancyAllowance": "number or null (as decimal, e.g. 0.03)",
    "effectiveGrossIncome": "number or null",

    "outgoings_councilRates": "number or null (annual)",
    "outgoings_insurance": "number or null (annual)",
    "outgoings_landTax": "number or null (annual)",
    "outgoings_managementPct": "number or null (as decimal)",
    "outgoings_managementAmt": "number or null (annual)",
    "outgoings_other": "number or null (annual)",
    "outgoings_total": "number or null",

    "netIncome": "number or null (annual NOI)",
    "capRate": "number or null (as decimal, e.g. 0.06)",
    "capitalisedValue": "number or null",

    "btl_leaseIncentives": "number or null",
    "btl_makeGood": "number or null",
    "btl_capexLeasing": "number or null",
    "btl_rentalShortfall": "number or null",
    "btl_remediation": "number or null",
    "btl_other": "number or null",
    "btl_total": "number or null",

    "adoptedValue": "number or null (cap value less BTL = GRV for commercial)",

    "units": "number or null",
    "avgPrice": "number or null",
    "grv": "number or null (for resi: units x avg price; for commercial: adopted value)",
    "presalesValue": "number or null",
    "presalesCount": "number or null",
    "unitBreakdown": [{"type":"string","beds":"number","baths":"number","cars":"number","size":"number sqm","price":"number"}],

    "constructionCost": "number or null",
    "totalDevCost": "number or null",
    "constructionTerm": "string or null",
    "builder": "string or null",
    "architect": "string or null",

    "loanAmount": "number or null",
    "existingDebt": "number or null",
    "totalAssets": "number or null",
    "totalLiabilities": "number or null",
    "netWorth": "number or null",

    "occupancy": "number or null (as decimal)",
    "wale": "number or null (years)",
    "gfa": "number or null (sqm)",
    "nla": "number or null (sqm)",
    "yearBuilt": "number or null"
  },
  "narrative": "2-3 paragraph credit narrative. For COMMERCIAL: lead with tenant covenant, lease term, income, cap rate, adopted value. For RESIDENTIAL: lead with units, GRV, presales, margin. Third person, formal, for a credit committee.",
  "flags": ["array of concerns — e.g. 'QS certificate required', 'Valuation on as-if-complete basis', 'Regional location may limit buyer pool'"],
  "summary": "One sentence summary of what this document tells us"
}

EXTRACTION RULES:
1. For commercial valuations: adopted value IS the GRV — set grv = adoptedValue
2. If you see a capitalisation table, extract EVERY line — income, each outgoing, cap rate, each BTL adjustment
3. If valuation says "as if complete" or "on completion", flag it
4. For service stations: tenant = fuel brand (Viva Energy, BP, Ampol), lease is typically net
5. Always extract zoning — confirms asset type (E4 = commercial, R2 = resi)
6. Set fields to null where you cannot extract with reasonable confidence`;

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
            text: `Analyse this ${docType || 'document'}. First determine the asset type and valuation methodology. Then extract ALL relevant fields — especially income, cap rate, outgoings, and BTL adjustments for commercial assets. Return ONLY the JSON object.`
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await res.json();
    if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };

    const textContent = data.content.find(c => c.type === 'text');
    if (!textContent) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'No text response from AI' }) };
    }

    let jsonText = textContent.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseErr) {
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
