// netlify/functions/extract-conditions.js
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
    if (fileBase64.length > 26000000) return { statusCode: 400, headers, body: JSON.stringify({ error: 'PDF too large. Maximum 15MB.' }) };

    const mediaType = fileType === 'pdf' ? 'application/pdf'
      : fileType === 'png' ? 'image/png'
      : fileType === 'jpg' || fileType === 'jpeg' ? 'image/jpeg'
      : 'application/pdf';

    const system = `You are an expert Australian property finance analyst reading a lender term sheet. Extract ALL conditions precedent exactly as written plus key deal terms. Return ONLY valid JSON with no markdown or backticks. Use this exact structure:
{"dealSummary":{"lender":"string","borrower":"string","facilityType":"bridging","purpose":"string","facilityAmount":0,"lvr":0,"interestRate":"string","term":"string","financialCloseDate":"YYYY-MM-DD","maturityDate":"YYYY-MM-DD","securityAddress":"string","establishmentFee":"string","commitmentFee":"string"},"conditions":[{"stage":"Board & credit approval","text":"exact condition text from document","tag":"admin","requiresDocument":false,"docLabel":null,"suggestedDueDaysBeforeFC":2}],"flags":["any concerns"],"summary":"one sentence summary"}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: system,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: mediaType, data: fileBase64 } },
            { type: 'text', text: 'Extract every condition precedent with exact wording. Group by stage. Return only JSON.' }
          ]
        }]
      })
    });

    const data = await res.json();
    if (!res.ok) return { statusCode: res.status, headers, body: JSON.stringify(data) };

    const textContent = data.content.find(c => c.type === 'text');
    if (!textContent) return { statusCode: 500, headers, body: JSON.stringify({ error: 'No response from AI' }) };

    const jsonText = textContent.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    try {
      const parsed = JSON.parse(jsonText);
      return { statusCode: 200, headers, body: JSON.stringify(parsed) };
    } catch(e) {
      return { statusCode: 200, headers, body: JSON.stringify({ conditions: [], dealSummary: {}, flags: ['Parse error: ' + e.message], summary: 'Extraction failed', raw: jsonText }) };
    }

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
