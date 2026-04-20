// Netlify serverless function — Credit Paper Generator
// Generates bank/non-bank credit papers from structured deal data
// Tier 1: Bank Discussion Paper (2–4pg) | Tier 2: Non-Bank Board Submission (5–10pg) | Tier 3: Full IM (25–35pg)

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Not allowed' };

  try {
    const data = JSON.parse(event.body);
    const { tier } = data;

    // ── System prompts per tier ──────────────────────────────────────────────
    const systemPrompts = {
      discussion: `You are an expert Australian commercial real estate credit analyst writing for a major bank (Big 4 or Tier 2).
Produce a concise Bank Credit Discussion Paper (2–4 pages) in clean HTML. Use Australian market conventions; reference RBA, APRA where relevant.
Tone: formal, analytical, restrained. Structure: Executive Summary → Borrower Profile → Security → Loan Structure → Key Risks & Mitigants.
Output ONLY inner HTML content — no <html>, <head>, or <body> tags. Use semantic elements and class attributes for styling.
All dollars in AUD. Dates in DD/MM/YYYY. LVR is gross. Refer to the facility as "Funding Request" throughout.`,

      board: `You are an expert Australian non-bank lender credit analyst writing a Board Credit Submission (5–10 pages).
Produce a comprehensive credit paper in clean HTML. Use Australian private credit market conventions (non-APRA).
Tone: thorough, risk-aware, commercially pragmatic. Include detailed financial analysis and a clear Recommendation.
Structure: Executive Summary → Transaction Overview → Borrower & Sponsor → Security Analysis → Loan Structure → Financial Analysis → Construction & Presales Analysis (if applicable) → Cash Flow → Risk Assessment → Recommendation.
Output ONLY inner HTML content — no <html>, <head>, or <body> tags. Use semantic elements and class attributes.
All dollars in AUD. Refer to the facility as "Funding Request". Bold the Recommendation: APPROVED / APPROVED SUBJECT TO CONDITIONS / DECLINED.`,

      im: `You are a senior Australian investment banker preparing a full Information Memorandum (IM) for a wholesale credit facility.
Produce an institutional-grade IM in clean HTML (25–35 pages equivalent).
Include: Executive Summary → Investment Highlights → Transaction Structure → Borrower & Sponsor → Market Analysis → Asset Description → Development Program → Financial Projections → Sensitivity Analysis → Risk Factors → Legal & Regulatory → Appendices outline.
Output ONLY inner HTML content — no <html>, <head>, or <body> tags. Use semantic elements and class attributes.
All dollars in AUD. Include a professional disclaimer footer. Refer to the facility as "Funding Request".`
    };

    // ── Build deal prompt from structured data ───────────────────────────────
    const fmt = n => n ? '$' + Number(n).toLocaleString('en-AU') : 'N/A';
    const pct = n => n ? n + '%' : 'N/A';
    const isResi = ['Residential Development', 'Land Subdivision'].includes(data.assetType);
    const isComm = ['Commercial', 'Industrial', 'Retail', 'Office', 'BTL'].includes(data.assetType);

    const prompt = `Generate a credit paper for the following transaction. Be specific with all numbers. Mark missing data as "TBC". Write as a senior analyst presenting to a credit committee.

=== TRANSACTION DATE ===
${data.dealDate || new Date().toLocaleDateString('en-AU')}

=== BORROWER / SPONSOR ===
Entity: ${data.borrowerName || 'Not provided'}
ABN: ${data.abn || 'N/A'}
Directors / Key Personnel: ${data.directors || 'Not provided'}
Guarantors: ${data.guarantors || 'Same as directors'}
Development Experience: ${data.borrowerExperience || 'Not specified'}
Net Assets (stated): ${fmt(data.netAssets)}
Liquidity: ${fmt(data.liquidity)}

=== SECURITY ===
Property Address: ${data.propertyAddress || 'Not provided'}
Asset Type: ${data.assetType || 'Not specified'}
Site Area: ${data.siteArea ? data.siteArea + ' sqm' : 'N/A'}
GFA: ${data.gfa ? data.gfa + ' sqm' : 'N/A'}
${data.unitCount ? 'Units / Lots: ' + data.unitCount : ''}
${data.floors ? 'Floors / Levels: ' + data.floors : ''}

=== LOAN STRUCTURE (FUNDING REQUEST) ===
Facility Type: ${data.facilityType || 'Construction Loan'}
Proposed Lender: ${data.lenderName || 'TBC'}
Loan Amount: ${fmt(data.loanAmount)}
LVR (Gross): ${pct(data.lvr)}
${data.ltc ? 'LTC: ' + pct(data.ltc) : ''}
Term: ${data.termMonths ? data.termMonths + ' months' : 'N/A'}
Interest Rate: ${data.interestRate ? data.interestRate + '% p.a.' : 'N/A'}
${data.lineFee ? 'Line / Establishment Fee: ' + data.lineFee + '%' : ''}
Repayment: ${data.repaymentType || 'Interest capitalised to loan'}

${isResi ? `=== DEVELOPMENT FINANCIALS ===
GRV (Total): ${fmt(data.grv)}
${data.unitCount && data.grv ? 'GRV per Unit: ' + fmt(Math.round(data.grv / data.unitCount)) : ''}
Land Value / Purchase Price: ${fmt(data.landValue)}
Construction Cost (Total): ${fmt(data.constructionCost)}
${data.gfa && data.constructionCost ? 'Construction Cost/sqm: ' + fmt(Math.round(data.constructionCost / data.gfa)) : ''}
${data.unitCount && data.constructionCost ? 'Construction Cost/Unit: ' + fmt(Math.round(data.constructionCost / data.unitCount)) : ''}
Net Development Profit: ${fmt(data.netProfit)}
Development Margin on Costs: ${pct(data.devMargin)}
Pre-Sales: ${data.presalesCount ? data.presalesCount + ' contracts' : ''} ${data.presalesValue ? '/ ' + fmt(data.presalesValue) : ''} ${data.presalesPct ? '(' + data.presalesPct + '% of GRV)' : ''}` : ''}

${isComm ? `=== INCOME / COMMERCIAL ANALYSIS ===
Net Passing Income: ${fmt(data.netIncome)}
Passing Yield: ${pct(data.passingYield)}
Market Cap Rate: ${pct(data.capRate)}
${data.wale ? 'WALE: ' + data.wale + ' years' : ''}
${data.vacancy ? 'Vacancy: ' + pct(data.vacancy) : ''}` : ''}

${data.additionalNotes ? `=== ADDITIONAL CONTEXT / BROKER NOTES ===
${data.additionalNotes}` : ''}

Paper tier: ${tier === 'discussion' ? 'Bank Credit Discussion Paper — concise, 2–4 pages' : tier === 'board' ? 'Non-Bank Board Submission — detailed, 5–10 pages, include Recommendation' : 'Full Information Memorandum — comprehensive, institutional-grade, 25–35 pages'}

Write the complete credit paper now.`;

    // ── Token budgets per tier ───────────────────────────────────────────────
    const maxTokens = { discussion: 3000, board: 5000, im: 8000 };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: maxTokens[tier] || 5000,
        system: systemPrompts[tier] || systemPrompts.board,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const aiData = await res.json();
    if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(aiData) };

    const textContent = aiData.content.find(c => c.type === 'text');
    if (!textContent) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No response from AI' }) };

    // Strip any accidental markdown code fences
    const html = textContent.text.replace(/```html\s*/g, '').replace(/```\s*/g, '').trim();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        html,
        tier,
        tokensUsed: aiData.usage?.output_tokens || null
      })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
