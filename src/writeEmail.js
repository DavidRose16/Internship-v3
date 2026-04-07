const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildGreeting(rowData) {
  const contactName = (rowData['Contact Name'] || '').trim();
  const company = (rowData['Company'] || '').trim();

  if (contactName) {
    const firstName = contactName.split(/\s+/)[0].replace(/[,;]/g, '').trim();
    if (firstName) return `Hi ${firstName},`;
  }

  if (company) {
    return `Hi ${company} team,`;
  }

  return 'Hi,';
}

function buildRecipientContext(rowData) {
  const company = rowData['Company'] || '';
  const contactName = rowData['Contact Name'] || '';
  const contactRole = rowData['Contact Role'] || '';

  return {
    company,
    contactName,
    contactRole,
    greeting: buildGreeting(rowData),
    isTargeted: Boolean(contactName),
  };
}

async function draftBody(rowData, background, voice, extraInstructions = '') {
  const { company, contactName, contactRole, greeting, isTargeted } = buildRecipientContext(rowData);
  const websiteSummary = rowData['Website Summary'] || '';
  const productWhatTheyDo = rowData['Product / What They Do'] || '';
  const keyObservation = rowData['Key Observation'] || '';
  const whyItFits = rowData['Why It Fits'] || '';
  const outreachNotes = rowData['Outreach Notes'] || '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 700,
    messages: [{
      role: 'user',
      content: `Write a cold internship outreach email.

RECIPIENT CONTEXT:
- Company: ${company}
- Contact name: ${contactName || 'None'}
- Contact role: ${contactRole || 'None'}
- Greeting to use exactly: ${greeting}
- Targeted email: ${isTargeted ? 'yes' : 'no, generic company/team email'}

COMPANY:
- Website summary: ${websiteSummary}
- Product / what they do: ${productWhatTheyDo}
- Key observation: ${keyObservation}
- Why it fits: ${whyItFits}
- Outreach notes: ${outreachNotes}

MY BACKGROUND:
${background}

VOICE & STYLE GUIDE:
${voice}

EXTRA INSTRUCTIONS:
${extraInstructions || 'None'}

RULES:
- MUST be under 120 words
- Start with the exact greeting provided above
- If this is not a targeted email, do not pretend to know a person
- Do not invent facts not present above
- Use the key observation naturally
- Do not sound like a mail merge
- No generic praise
- Be direct about wanting to contribute or intern
- Include a low-pressure ask at the end
- Do NOT include a subject line
- Do NOT include brackets or placeholders
- No em dashes
- Respond with ONLY the email body`
    }]
  });

  return message.content[0].text.trim();
}

async function generateEmail(rowData, background, voice, extraInstructions = '') {
  const firstDraft = await draftBody(rowData, background, voice, extraInstructions);

  if (wordCount(firstDraft) <= 120) {
    return firstDraft;
  }

  const trimmed = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `This email is ${wordCount(firstDraft)} words. Rewrite it to be under 120 words while keeping the specific company details and natural tone. Preserve the opening greeting exactly. No em dashes.

${firstDraft}

Respond with ONLY the rewritten email body.`
    }]
  });

  return trimmed.content[0].text.trim();
}

async function generateSubject(rowData) {
  const company = rowData['Company'] || '';
  const productWhatTheyDo = rowData['Product / What They Do'] || '';
  const keyObservation = rowData['Key Observation'] || '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 80,
    messages: [{
      role: 'user',
      content: `Write a short subject line for a cold internship outreach email to ${company}.

What they do: ${productWhatTheyDo}
Specific observation: ${keyObservation}

Rules:
- Under 8 words
- No generic lines like Internship Opportunity or Excited to Connect
- Reference something specific
- Lowercase is fine
- No em dashes
- Respond with ONLY the subject line`
    }]
  });

  return message.content[0].text.trim();
}

async function generateDraftFromRow(rowData, background, voice, extraInstructions = '') {
  const body = await generateEmail(rowData, background, voice, extraInstructions);
  const subject = await generateSubject(rowData);

  let writingConfidence = 'medium';
  if ((rowData['Research Confidence'] || '').toLowerCase() === 'high') {
    writingConfidence = 'high';
  }
  if ((rowData['Research Confidence'] || '').toLowerCase() === 'low') {
    writingConfidence = 'low';
  }

  return {
    subject,
    body,
    writingConfidence,
  };
}

module.exports = {
  generateEmail,
  generateSubject,
  generateDraftFromRow,
  buildGreeting,
};
