const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');

const anthropic = new Anthropic();

/**
 * Fetch and extract text content from a company website.
 */
async function fetchWebsite(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      maxRedirects: 3,
      maxContentLength: 500000,
    });
    // Strip scripts, styles, and HTML tags; keep text
    const text = response.data
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    return text;
  } catch {
    return null;
  }
}

/**
 * Parse JSON from Claude's response, handling markdown code fences.
 */
function parseJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Research a company and produce a structured summary.
 * Returns null if research quality is too low to write a good email.
 *
 * @param {{name, website, category, reason}} company
 * @param {string} background - contents of background.md
 * @returns {Promise<{description, whyFit, specificObservation, bestContactType, confidenceScore}|null>}
 */
async function researchCompany(company, background) {
  const websiteText = await fetchWebsite(company.website);

  const websiteBlock = websiteText
    ? `\n\nContent scraped from their website (${company.website}):\n${websiteText}`
    : '\n\n(Could not fetch website content.)';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `Research this company for internship outreach purposes.

Company: ${company.name}
Website: ${company.website}
Category: ${company.category}
Initial note: ${company.reason}
${websiteBlock}

About the person reaching out:
${background}

Produce a research summary as JSON with these fields:
- description: 2-3 sentences on what the company does
- whyFit: 1-2 sentences on why this person's background makes them a good fit
- specificObservation: one concrete, specific observation about the company — a recent product launch, a specific technology they use, a particular problem they solve, a recent hire, etc. This MUST be real and specific, not generic praise like "innovative company" or "great culture"
- bestContactType: who to reach out to (e.g. "founder", "CTO", "head of engineering", "recruiting")
- confidenceScore: 1-5 rating of research quality (5 = very confident with specific details, 1 = vague/mostly guessing)

If you lack enough specific information to write a genuine non-generic email, set confidenceScore to 1 or 2.

Respond ONLY with JSON. No markdown fences, no explanation.`
    }]
  });

  const research = parseJSON(message.content[0].text);

  if (research.confidenceScore < 3) {
    return null;
  }

  return research;
}

module.exports = { researchCompany };
