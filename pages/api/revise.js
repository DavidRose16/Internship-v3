/**
 * pages/api/revise.js — POST /api/revise
 *
 * Rewrites an email draft body according to a free-text instruction, using
 * Claude. The same hard rules as the generation prompt are enforced (120–180
 * words, no em dashes, no filler). Returns the revised body only.
 *
 * Body: { body, instruction, company, contactName, contactRole,
 *         productWhatTheyDo, keyObservation, whyItFits }
 */
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    body,
    instruction,
    company,
    contactName,
    contactRole,
    productWhatTheyDo,
    keyObservation,
    whyItFits,
  } = req.body || {};

  if (!body || !instruction) {
    return res.status(400).json({ error: 'body and instruction are required' });
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: `Revise this internship outreach email according to the instruction below.

CURRENT DRAFT:
${body}

INSTRUCTION:
${instruction}

COMPANY CONTEXT:
- Company: ${company || '(unknown)'}
- What they do: ${productWhatTheyDo || ''}
- Key observation: ${keyObservation || ''}
- Why it fits: ${whyItFits || ''}

RECIPIENT:
- Name: ${contactName || '(not specified)'}
- Role: ${contactRole || '(not specified)'}

RULES:
- Follow the instruction carefully
- Preserve the opening greeting unless the instruction changes it
- 120-180 words total
- No em dashes (—)
- No buzzwords: innovative, cutting-edge, passionate, excited
- No filler: "I wanted to reach out", "I came across", "super interesting"
- No curly quotes or smart punctuation
- Return ONLY the revised email body, nothing else`,
        },
      ],
    });

    res.json({ body: message.content[0].text.trim() });
  } catch (err) {
    console.error('[api/revise] error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
