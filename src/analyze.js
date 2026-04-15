/**
 * src/analyze.js — Company research and fit evaluation using Claude.
 *
 * Fetches website text via Exa's content API, then prompts Claude to return a
 * structured JSON assessment: website summary, product description, key observation,
 * why it fits, outreach angle, fit score, research confidence, and a keep/skip
 * decision. Rows marked "skip" are not advanced to the write stage.
 */
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
- Skip only if this is a large enterprise, a non-tech company, or has no clear connection to AI or software. Do not skip based on size alone if the company is technical.
- Do not assume specific background details not provided here.
- Do not flatter or speculate about David.
- Keep "Why It Fits" grounded in company stage, ambition, technical depth, or learning opportunity.
- "Outreach Notes" should suggest an actual email angle, not repeat the summary.
- If the company mainly offers generic AI tools, creative tools, agency services, or broad consumer utilities without a sharp technical wedge, lean skip.
- Be concise.
- No markdown fences.

VC / PE / Investment firm rules (apply these when the company is a venture capital firm, venture fund, investment firm, or similar):
- Do NOT skip VC/PE/investment firms.
- Set status to "keep".
- Set fitScore based on investment focus: 8-10 if they actively invest in AI, developer tools, infrastructure, or early-stage technical companies; 5-7 if they invest broadly in tech; 2-4 if their focus is unclear or non-technical.
- Set keyObservation to a sharp sentence describing what they invest in and who the key partners are, based on the site.
- Set outreachNotes to "internship or analyst role outreach".
- Set researchConfidence to "high" if their investment thesis and portfolio focus are clearly stated on the site, otherwise "medium".
- Set whyItFits to explain why this firm's portfolio focus makes it a useful internship or analyst target for a technical generalist.`;

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
