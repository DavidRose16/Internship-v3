/**
 * src/writeEmail.js — Personalized cold email generation using Claude.
 *
 * Builds the email prompt from company context, recipient info, background.md,
 * and voice.md, then validates the result against a fluff pattern list and a
 * 120–180 word count limit. Regenerates once if validation fails. A separate
 * trim pass handles drafts that exceed the word limit.
 *
 * Exports used by both the CLI pipeline (runWrite, runDrafts) and the web UI
 * review page (via /api/revise and /api/approve).
 */
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

// Phrases that indicate a bad email — triggers one regeneration
const FLUFF_PATTERNS = [
  /i wanted to reach out/i,
  /i came across/i,
  /super interesting/i,
  /i (was |am )?(really |truly )?fascinated/i,
  /\binnovative\b/i,
  /cutting.?edge/i,
  /hope this finds you/i,
  /feel free to/i,
  /don't hesitate/i,
  /excited to connect/i,
  /—/,
  /[""'']/,
];

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
  // 'Contact Type' is injected transiently by runDrafts — not stored in sheet
  const contactType = rowData['Contact Type'] || (contactName ? 'personal' : 'generic');
  const contactConfidence = Number(rowData['Contact Confidence']) || 0;

  let confidenceLevel = 'low';
  if (contactType === 'personal') {
    confidenceLevel = contactConfidence >= 95 ? 'high' : 'medium';
  }

  return {
    company,
    contactName,
    contactRole,
    contactType,
    confidenceLevel,
    greeting: buildGreeting(rowData),
    isTargeted: Boolean(contactName),
  };
}

function validateEmail(body) {
  if (wordCount(body) > 180) return false;
  for (const pattern of FLUFF_PATTERNS) {
    if (pattern.test(body)) return false;
  }
  return true;
}

async function draftBody(rowData, background, voice, extraInstructions = '') {
  const { company, contactName, contactRole, contactType, confidenceLevel, greeting, isTargeted } =
    buildRecipientContext(rowData);
  const productWhatTheyDo = rowData['Product / What They Do'] || '';
  const keyObservation = rowData['Key Observation'] || '';
  const whyItFits = rowData['Why It Fits'] || '';
  const outreachNotes = rowData['Outreach Notes'] || '';

  const toneInstruction =
    contactType === 'personal'
      ? `Sharp and direct. Assume the reader is technical.${confidenceLevel === 'high' ? ' No social softening. Get straight to the point.' : ' Clean and confident.'}`
      : `Direct and clear. Slightly broader since this may reach a team inbox. Still concise.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 700,
    messages: [
      {
        role: 'user',
        content: `Write a cold internship outreach email.

RECIPIENT:
- Company: ${company}
- Greeting: ${greeting}
- Contact type: ${contactType === 'personal' ? `personal (${contactRole || 'unknown role'})` : 'generic team inbox'}${isTargeted ? `\n- Name: ${contactName}` : ''}

COMPANY CONTEXT:
- What they do: ${productWhatTheyDo}
- Key observation: ${keyObservation}
- Why it fits: ${whyItFits}${outreachNotes ? `\n- Notes: ${outreachNotes}` : ''}

MY BACKGROUND:
${background}

STRUCTURE:
1. First sentence: a specific, concrete observation about what this company is building or doing. Do not start with "I". No generic praise. Reference something real.
2. 1–2 sentences: connect their work to something concrete from my background. Direct, not philosophical.
3. 1 sentence: a simple, direct ask. No hedging.

TONE:
${toneInstruction}

STYLE NOTES:
${voice}

RULES:
- Start with exactly: ${greeting}
- 120–180 words total
- No em dashes
- No buzzwords: innovative, cutting-edge, passionate, excited
- No filler: "I wanted to reach out", "I came across", "super interesting"
- No sentences longer than 25 words
- No generic praise
- Every sentence adds new information
- Do NOT include a subject line, brackets, or placeholders
- Do NOT invent facts not present above${extraInstructions ? `\n\nEXTRA:\n${extraInstructions}` : ''}

Respond with ONLY the email body.`,
      },
    ],
  });

  return message.content[0].text.trim();
}

async function trimBody(draft) {
  const wc = wordCount(draft);
  const trimmed = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `This email is ${wc} words. Rewrite it to be under 180 words. Keep the specific company details and natural tone. Preserve the opening greeting exactly. No em dashes. No filler phrases.

${draft}

Respond with ONLY the rewritten email body.`,
      },
    ],
  });

  return trimmed.content[0].text.trim();
}

async function generateEmail(rowData, background, voice, extraInstructions = '') {
  let body = await draftBody(rowData, background, voice, extraInstructions);

  if (wordCount(body) > 180) {
    body = await trimBody(body);
  }

  // Validate output; regenerate once if it fails
  if (!validateEmail(body)) {
    body = await draftBody(rowData, background, voice, extraInstructions);
    if (wordCount(body) > 180) {
      body = await trimBody(body);
    }
  }

  return body;
}

// Subject is always "Internship" — no dynamic generation
function generateSubject() {
  return 'Internship';
}

async function generateDraftFromRow(rowData, background, voice, extraInstructions = '') {
  const body = await generateEmail(rowData, background, voice, extraInstructions);
  const subject = generateSubject();

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
