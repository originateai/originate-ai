// netlify/functions/deal-email.js
// Sends branded lifecycle emails for deal status changes, lender responses,
// welcome emails, document notifications, credit paper alerts
// Uses Resend API with getkredit.ai branded HTML templates

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'settlements@getkredit.ai';
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const APP_URL = process.env.APP_URL || 'https://getkredit.ai';
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!RESEND_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Resend not configured' }) };

  // ── SEND EMAIL ──────────────────────────────────────────────────────────
  async function sendEmail(to, subject, html, cc) {
    const recipients = Array.isArray(to) ? to : [to];
    if (cc) {
      const ccList = Array.isArray(cc) ? cc : [cc];
      ccList.forEach(c => { if (c && !recipients.includes(c)) recipients.push(c); });
    }
    // Always BCC admin
    const bcc = [];
    if (ADMIN_EMAIL && !recipients.includes(ADMIN_EMAIL)) bcc.push(ADMIN_EMAIL);

    const payload = {
      from: `getkredit.ai <${FROM_EMAIL}>`,
      to: recipients.filter(Boolean),
      subject,
      html
    };
    if (bcc.length > 0) payload.bcc = bcc;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) console.error('Resend error:', data);
    return data;
  }

  // ── FETCH DEAL FROM SUPABASE ────────────────────────────────────────────
  async function fetchDeal(dealId) {
    if (!dealId || !SUPABASE_URL || !SUPABASE_KEY) return null;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/deals?id=eq.${dealId}&select=*`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const data = await res.json();
    return data && data.length > 0 ? data[0] : null;
  }

  // ── HTML WRAPPER ────────────────────────────────────────────────────────
  function wrap(bannerColor, bannerText, bodyHtml, ctaUrl, ctaText) {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'DM Sans',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:white;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">

  <tr><td style="background:#0F172A;padding:24px 32px">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:white">get<span style="color:#14B8A6">kredit.ai</span></div>
    <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:4px">Property Development Finance</div>
  </td></tr>

  ${bannerText ? `<tr><td style="background:${bannerColor};padding:14px 32px">
    <div style="font-size:13px;font-weight:700;color:white;letter-spacing:0.5px">${bannerText}</div>
  </td></tr>` : ''}

  <tr><td style="padding:28px 32px">${bodyHtml}</td></tr>

  ${ctaUrl ? `<tr><td style="padding:0 32px 28px">
    <a href="${ctaUrl}" style="display:inline-block;padding:12px 24px;background:#0D9488;color:white;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">${ctaText || 'View Details →'}</a>
  </td></tr>` : ''}

  <tr><td style="padding:20px 32px;border-top:1px solid #e2e8f0;background:#f8fafc">
    <div style="font-size:11px;color:#94a3b8">This is an automated email from getkredit.ai. If you have questions, reply to this email or contact your broker directly.</div>
  </td></tr>

</table></td></tr></table></body></html>`;
  }

  // ── DEAL INFO BLOCK (reused across templates) ───────────────────────────
  function dealBlock(deal) {
    if (!deal) return '';
    const rows = [
      deal.address ? ['Project', deal.address] : null,
      deal.borrower_name ? ['Borrower', deal.borrower_name] : null,
      deal.company_name ? ['Company', deal.company_name] : null,
      deal.grv ? ['GRV', '$' + Number(deal.grv).toLocaleString('en-AU')] : null,
      deal.calc_tdc ? ['Total Dev Cost', '$' + Number(deal.calc_tdc).toLocaleString('en-AU')] : null,
      deal.calc_facility ? ['Facility', '$' + Number(deal.calc_facility).toLocaleString('en-AU')] : null,
      deal.deal_number ? ['Deal #', deal.deal_number] : null,
    ].filter(Boolean);

    return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:16px 0">
      ${rows.map(r => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
        <span style="color:#64748b">${r[0]}</span>
        <span style="color:#0f172a;font-weight:600">${r[1]}</span>
      </div>`).join('')}
    </div>`;
  }

  // ── EMAIL TEMPLATES ─────────────────────────────────────────────────────
  const templates = {

    // ── DEAL STATUS CHANGES ──

    feasibility_complete: (deal) => ({
      to: deal.borrower_email,
      subject: `Feasibility Complete — ${deal.address || 'Your Project'}`,
      html: wrap('#0D9488', 'FEASIBILITY COMPLETE',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${deal.borrower_name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">Your feasibility analysis is ready for review. We've run the numbers on your project and you can now view the full results including development margin, funding structure, and cash flow projections.</div>
         ${dealBlock(deal)}
         <div style="font-size:13px;color:#64748b;margin-top:16px">Next step: Review your results and submit to our lender panel when you're ready.</div>`,
        `${APP_URL}/feasibility-capval.html`, 'View Feasibility Results →')
    }),

    submitted: (deal) => ({
      to: ADMIN_EMAIL,
      cc: deal.borrower_email,
      subject: `New Deal Submitted — ${deal.address || 'Project'} — ${deal.borrower_name || ''}`,
      html: wrap('#0D9488', 'NEW DEAL SUBMITTED',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">A new deal has been submitted for review.</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">${deal.borrower_name || 'A borrower'} has submitted their project for lender matching. Please review the deal details and release to appropriate lenders.</div>
         ${dealBlock(deal)}`,
        `${APP_URL}/admin.html`, 'Open Admin Panel →')
    }),

    under_review: (deal) => ({
      to: deal.borrower_email,
      subject: `Deal Under Review — ${deal.address || 'Your Project'}`,
      html: wrap('#d97706', 'UNDER REVIEW',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${deal.borrower_name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">Great news — your deal is now being reviewed by our lender panel. We'll notify you as soon as we receive responses. This typically takes 2–5 business days.</div>
         ${dealBlock(deal)}
         <div style="font-size:13px;color:#64748b;margin-top:16px">You can track the status of your deal anytime from your portal.</div>`,
        `${APP_URL}/portal.html`, 'View My Deals →')
    }),

    approved: (deal) => ({
      to: deal.borrower_email,
      subject: `✓ Deal Approved — ${deal.address || 'Your Project'}`,
      html: wrap('#059669', 'APPROVED',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${deal.borrower_name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">Congratulations! Your deal has been approved. A lender has provided an indicative term sheet and we're ready to move to the next stage.</div>
         ${dealBlock(deal)}
         <div style="font-size:13px;color:#64748b;margin-top:16px">Your broker will be in touch to discuss the term sheet and next steps. In the meantime, you can review the details in your portal.</div>`,
        `${APP_URL}/portal.html`, 'View Approval Details →')
    }),

    declined: (deal) => ({
      to: deal.borrower_email,
      subject: `Deal Update — ${deal.address || 'Your Project'}`,
      html: wrap('#dc2626', 'DEAL UPDATE',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${deal.borrower_name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">Unfortunately, we weren't able to secure approval for your project in its current form. This doesn't mean the project isn't viable — it may need restructuring or a different lender approach.</div>
         ${dealBlock(deal)}
         <div style="font-size:13px;color:#64748b;margin-top:16px">We recommend reviewing the feasibility assumptions and discussing options with your broker. We can often find a path forward with adjustments to the deal structure.</div>`,
        `${APP_URL}/portal.html`, 'View Deal Details →')
    }),

    settled: (deal) => ({
      to: deal.borrower_email,
      subject: `🎉 Deal Settled — ${deal.address || 'Your Project'}`,
      html: wrap('#059669', 'SETTLED',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${deal.borrower_name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">Congratulations — your deal has officially settled! All conditions have been met and the facility is now in place.</div>
         ${dealBlock(deal)}
         <div style="font-size:13px;color:#64748b;margin-top:16px">You can continue to track your settlement conditions and project timeline from your settlement dashboard.</div>`,
        `${APP_URL}/settlement.html`, 'View Settlement Dashboard →')
    }),

    withdrawn: (deal) => ({
      to: ADMIN_EMAIL,
      cc: deal.borrower_email,
      subject: `Deal Withdrawn — ${deal.address || 'Project'} — ${deal.borrower_name || ''}`,
      html: wrap('#64748b', 'WITHDRAWN',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">A deal has been withdrawn.</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">${deal.borrower_name || 'The borrower'} has withdrawn their project from the process.</div>
         ${dealBlock(deal)}`,
        `${APP_URL}/admin.html`, 'Open Admin Panel →')
    }),

    // ── LENDER RESPONSE ──

    lender_response: (deal, extra) => ({
      to: deal.borrower_email,
      cc: ADMIN_EMAIL,
      subject: `Lender Response — ${extra.lender_name || 'A lender'} — ${deal.address || 'Your Project'}`,
      html: wrap('#0D9488', 'LENDER RESPONSE RECEIVED',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${deal.borrower_name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">A lender has responded to your deal submission.</div>
         <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:16px 0">
           <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:8px">Lender</div>
           <div style="font-size:16px;font-weight:700;color:#0f172a">${extra.lender_name || 'N/A'}</div>
           ${extra.response_status ? `<div style="margin-top:8px;display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${extra.response_status === 'interested' ? '#05966820' : '#dc262620'};color:${extra.response_status === 'interested' ? '#059669' : '#dc2626'}">${extra.response_status === 'interested' ? 'Interested' : 'Declined'}</div>` : ''}
           ${extra.notes ? `<div style="margin-top:12px;font-size:13px;color:#475569;line-height:1.6">${extra.notes}</div>` : ''}
         </div>
         ${dealBlock(deal)}`,
        `${APP_URL}/portal.html`, 'View Response →')
    }),

    // ── LENDER INVITATION ──

    lender_invitation: (deal, extra) => ({
      to: extra.lender_email,
      subject: `New Deal Opportunity — ${deal.address || 'Project'} — ${deal.grv ? '$' + Number(deal.grv).toLocaleString('en-AU') : ''}`,
      html: wrap('#0F172A', 'NEW DEAL OPPORTUNITY',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${extra.lender_contact || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">A new development deal has been submitted that matches your lending criteria. Please review the details and submit your response via the lender portal.</div>
         ${dealBlock(deal)}
         <div style="background:#F0FDFA;border:1px solid #CCFBF1;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:13px;color:#0F766E">
           <strong>Action required:</strong> Log in to the lender portal to review the full deal pack and submit your indicative terms.
         </div>`,
        `${APP_URL}/lender-portal.html?deal=${deal.id}`, 'Review Deal →')
    }),

    // ── WELCOME EMAIL ──

    welcome: (deal, extra) => ({
      to: extra.email,
      subject: `Welcome to getkredit.ai`,
      html: wrap('#0D9488', 'WELCOME',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${extra.name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">Welcome to getkredit.ai — the smart way to structure and fund your property development.</div>
         <div style="font-size:14px;color:#475569;line-height:1.7;margin-top:12px">Here's what you can do:</div>
         <div style="margin:16px 0">
           <div style="padding:8px 0;font-size:14px;color:#0f172a">① <strong>Run a feasibility</strong> — model your project costs, revenue, and returns</div>
           <div style="padding:8px 0;font-size:14px;color:#0f172a">② <strong>Match with lenders</strong> — get indicative terms from our panel</div>
           <div style="padding:8px 0;font-size:14px;color:#0f172a">③ <strong>Track settlement</strong> — manage conditions precedent and due dates</div>
           <div style="padding:8px 0;font-size:14px;color:#0f172a">④ <strong>Generate credit papers</strong> — AI-powered submissions</div>
         </div>`,
        `${APP_URL}/development-chat.html`, 'Start Your First Deal →')
    }),

    // ── DOCUMENT UPLOADED ──

    document_uploaded: (deal, extra) => ({
      to: ADMIN_EMAIL,
      subject: `Document Uploaded — ${deal.address || 'Project'} — ${extra.filename || 'file'}`,
      html: wrap('#475569', 'DOCUMENT UPLOADED',
        `<div style="font-size:14px;color:#475569;line-height:1.7">${deal.borrower_name || 'A borrower'} has uploaded a new document to their deal.</div>
         <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin:16px 0">
           <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;margin-bottom:8px">Document</div>
           <div style="font-size:14px;font-weight:600;color:#0f172a">${extra.filename || 'Unknown'}</div>
           ${extra.doc_type ? `<div style="font-size:12px;color:#64748b;margin-top:4px">Type: ${extra.doc_type}</div>` : ''}
         </div>
         ${dealBlock(deal)}`,
        `${APP_URL}/admin.html`, 'Open Admin Panel →')
    }),

    // ── CREDIT PAPER GENERATED ──

    credit_paper: (deal, extra) => ({
      to: deal.borrower_email,
      cc: ADMIN_EMAIL,
      subject: `Credit Paper Ready — ${deal.address || 'Your Project'}`,
      html: wrap('#0D9488', 'CREDIT PAPER READY',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${deal.borrower_name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">Your credit paper has been generated and is ready for review. This document can be used for lender submissions and board presentations.</div>
         ${dealBlock(deal)}
         <div style="font-size:13px;color:#64748b;margin-top:16px">${extra.tier ? 'Tier: ' + extra.tier : ''}</div>`,
        `${APP_URL}/credit-paper.html?deal=${deal.id}`, 'View Credit Paper →')
    }),

    // ── PASSWORD RESET ──

    password_reset: (deal, extra) => ({
      to: extra.email,
      subject: `Password Reset — getkredit.ai`,
      html: wrap('#475569', 'PASSWORD RESET',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${extra.name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</div>
         <div style="font-size:13px;color:#64748b;margin-top:16px">If you didn't request this, you can safely ignore this email.</div>`,
        extra.reset_url || `${APP_URL}/login.html`, 'Reset Password →')
    }),

    // ── DEAL RELEASED TO LENDERS ──

    released_to_lenders: (deal) => ({
      to: deal.borrower_email,
      cc: ADMIN_EMAIL,
      subject: `Deal Released to Lenders — ${deal.address || 'Your Project'}`,
      html: wrap('#0D9488', 'RELEASED TO LENDER PANEL',
        `<div style="font-size:15px;color:#0f172a;margin-bottom:8px">Hi ${deal.borrower_name || 'there'},</div>
         <div style="font-size:14px;color:#475569;line-height:1.7">Your deal has been released to our lender panel. Matching lenders will be notified and we'll keep you updated as responses come in.</div>
         ${dealBlock(deal)}
         <div style="background:#F0FDFA;border:1px solid #CCFBF1;border-radius:8px;padding:12px 16px;margin:16px 0;font-size:13px;color:#0F766E">
           Typically, you'll start receiving lender responses within 2–5 business days.
         </div>`,
        `${APP_URL}/portal.html`, 'Track Your Deal →')
    })
  };

  // ── MAIN HANDLER ────────────────────────────────────────────────────────
  try {
    const body = JSON.parse(event.body);
    const { type, deal_id, extra } = body;

    if (!type) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email type' }) };

    // For welcome/password_reset, no deal needed
    let deal = {};
    if (deal_id) {
      deal = await fetchDeal(deal_id) || {};
    }

    const template = templates[type];
    if (!template) return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown email type: ${type}` }) };

    const email = template(deal, extra || {});

    if (!email.to) {
      return { statusCode: 200, headers, body: JSON.stringify({ skipped: true, reason: 'No recipient email' }) };
    }

    const result = await sendEmail(email.to, email.subject, email.html, email.cc);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, type, to: email.to, subject: email.subject, resend: result })
    };

  } catch (err) {
    console.error('deal-email error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
