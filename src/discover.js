const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic();

/**
 * Parse JSON from Claude's response, handling markdown code fences.
 */
function parseJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Discover companies for outreach using Claude.
 * @param {string[]} categories - e.g. ["AI startups", "VC firms"]
 * @param {string[]} existingCompanies - names already in the sheet
 * @param {number} count - how many companies to find
 * @returns {Promise<Array<{name, website, category, reason}>>}
 */
async function discoverCompanies(categories, existingCompanies, count) {
  const excludeBlock = existingCompanies.length > 0
    ? `\n\nDo NOT include any of these companies (already contacted):\n${existingCompanies.join('\n')}`
    : '';

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are helping a college student find companies for internship outreach.

Discover exactly ${count} companies across these categories: ${categories.join(', ')}.

For each company provide:
- name: the company name
- website: the company's main website URL
- category: which of the given categories it falls into
- reason: one sentence on why this company is worth reaching out to for an internship

Focus on:
- Companies likely to have internship opportunities or be open to hiring interns
- A mix of well-known and lesser-known companies
- Companies that are actively growing or recently funded
- Real companies with real websites — do not invent companies
${excludeBlock}

Respond ONLY with a JSON array. No markdown fences, no explanation. Example format:
[{"name":"Acme Corp","website":"https://acme.com","category":"AI startups","reason":"Recently raised Series A and expanding their engineering team"}]`
    }]
  });

  return parseJSON(message.content[0].text);
}

module.exports = { discoverCompanies };
