const Anthropic = require('@anthropic-ai/sdk');
const Exa = require('exa-js').default;

const anthropic = new Anthropic();
const exa = new Exa(process.env.EXA_API_KEY);

function parseJSON(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

async function fetchWebsiteText(url) {
  const response = await exa.getContents([url], {
    text: { maxCharacters: 6000 },
  });

  const results = response?.results || [];
  const first = results[0] || {};
  return (first.text || '').trim();
}

async function analyzeRow(rowData) {
  const company = rowData['Company'] || '';
  const url = rowData['Source URL'] || '';
  const searchQuery = rowData['Search Query'] || '';

  if (!url) {
    return {
      websiteSummary: '',
      productWhatTheyDo: '',
      keyObservation: '',
      whyItFits: '',
      outreachNotes: '',
      fitScore: '0',
      researchConfidence: 'low',
      status: 'skip',
      skipReason: 'Missing Source URL',
    };
  }

  const websiteText = await fetchWebsiteText(url);

  if (!websiteText) {
    return {
      websiteSummary: '',
      productWhatTheyDo: '',
      keyObservation: '',
      whyItFits: '',
      outreachNotes: '',
      fitScore: '0',
      researchConfidence: 'low',
      status: 'skip',
      skipReason: 'No website content retrieved',
    };
  }

  const prompt = `You are analyzing a company for internship outreach.

Company: ${company}
URL: ${url}
Search query that found it: ${searchQuery}

Here is website text:
${websiteText}

Return ONLY valid JSON with this exact shape:
{
  "websiteSummary": "40-70 word grounded summary of the company",
  "productWhatTheyDo": "1 sentence, max 20 words",
  "keyObservation": "1 sharp sentence, max 25 words, actually usable in outreach",
  "whyItFits": "1 grounded sentence about why this company may be a strong internship target for a curious, technical, high-agency generalist",
  "outreachNotes": "1 sentence describing what angle to use in the email",
  "fitScore": "integer from 1 to 10",
  "researchConfidence": "low or medium or high",
  "status": "keep or skip",
  "skipReason": "blank if keep, otherwise very short reason"
}

Rules:
- Be grounded in the website text only.
- Skip if this is clearly not a startup, is a VC, is too big, is too vague, or is irrelevant.
- Do not assume specific background details not provided here.
- Do not flatter or speculate about David.
- Keep "Why It Fits" grounded in company stage, ambition, technical depth, or learning opportunity.
- "Outreach Notes" should suggest an actual email angle, not repeat the summary.
- If the company mainly offers generic AI tools, creative tools, agency services, or broad consumer utilities without a sharp technical wedge, lean skip.
- Be concise.
- No markdown fences.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  return parseJSON(message.content[0].text);
}

module.exports = { analyzeRow };
