// Netlify serverless function — AI Copilot
// Handles free-text chat messages during deal intake and feasibility workflows
// Provides contextual responses based on current deal data

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Not allowed' };

  try {
    const { message, context, history } = JSON.parse(event.body);

    // Build context summary from deal data
    const ctx = context || {};
    const contextLines = [];
    if (ctx.address) contextLines.push('Property: ' + ctx.address);
    if (ctx.borrowerName || ctx.entityName) contextLines.push('Borrower: ' + (ctx.borrowerName || ctx.entityName));
    if (ctx.assetType) contextLines.push('Asset Type: ' + ctx.assetType);
    if (ctx.grv) contextLines.push('GRV: $' + Number(ctx.grv).toLocaleString('en-AU'));
    if (ctx.landValue || ctx.landCost) contextLines.push('Land: $' + Number(ctx.landValue || ctx.landCost).toLocaleString('en-AU'));
    if (ctx.constructionCost) contextLines.push('Construction: $' + Number(ctx.constructionCost).toLocaleString('en-AU'));
    if (ctx.grossIncome) contextLines.push('Gross Income: $' + Number(ctx.grossIncome).toLocaleString('en-AU') + ' p.a.');
    if (ctx.netIncome) contextLines.push('Net Income: $' + Number(ctx.netIncome).toLocaleString('en-AU') + ' p.a.');
    if (ctx.capRate) contextLines.push('Cap Rate: ' + (ctx.capRate * 100).toFixed(1) + '%');
    if (ctx.units) contextLines.push('Units: ' + ctx.units);
    if (ctx.loanAmount) contextLines.push('Loan: $' + Number(ctx.loanAmount).toLocaleString('en-AU'));

    const contextBlock = contextLines.length > 0
      ? '\n\nCurrent deal data:\n' + contextLines.join('\n')
      : '';

    const system = `You are a senior Australian commercial real estate finance analyst working as an AI copilot inside getkredit.ai.
You help borrowers, brokers, and developers with questions about their deals, feasibility analysis, loan structuring, and the Australian property finance market.
Be concise, specific, and commercially pragmatic. Use Australian conventions (AUD, LVR not LTV, DD/MM/YYYY).
If asked about specific numbers, calculate from the deal data provided. If data is missing, say what you need.
Keep responses under 150 words unless the question requires detailed analysis.${contextBlock}`;

    // Build messages array
    const messages = [];
    if (history && Array.isArray(history)) {
      history.forEach(h => {
        if (h.role && h.content) {
          messages.push({ role: h.role, content: h.content });
        }
      });
    }
    messages.push({ role: 'user', content: message });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: system,
        messages: messages
      })
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, headers, body: JSON.stringify({ error: data.error?.message || 'API error' }) };
    }

    const textBlock = data.content.find(c => c.type === 'text');
    const reply = textBlock ? textBlock.text : 'Sorry, I could not generate a response.';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply })
    };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
