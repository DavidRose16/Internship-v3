const axios = require('axios');

/**
 * Extract a bare domain from a URL.
 * "https://www.example.com/about" -> "example.com"
 */
function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

/**
 * Find the best contact at a company using the Hunter.io API.
 * Prioritizes founders -> partners -> engineering leads -> recruiters.
 *
 * @param {string} domain - company domain (e.g. "stripe.com")
 * @param {string} apiKey - Hunter.io API key
 * @returns {Promise<{email, name, position, confidence}|null>}
 */
async function findContact(domain, apiKey) {
  if (!apiKey) {
    return null;
  }

  try {
    const response = await axios.get('https://api.hunter.io/v2/domain-search', {
      params: {
        domain,
        api_key: apiKey,
        limit: 10,
      },
      timeout: 10000,
    });

    const emails = response.data?.data?.emails || [];

    if (emails.length === 0) {
      return null;
    }

    // Priority order for role matching
    const priorities = [
      /founder|co-founder|ceo/i,
      /partner|managing\s*partner/i,
      /cto|vp.*eng|head.*eng|chief.*tech/i,
      /hiring|recruit|talent|people\s*ops/i,
      /director|manager/i,
    ];

    for (const pattern of priorities) {
      const match = emails.find(e => pattern.test(e.position || ''));
      if (match) {
        return formatContact(match);
      }
    }

    // Fallback: highest-confidence email
    const best = emails.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    return formatContact(best);
  } catch (err) {
    console.error(`  Hunter.io error for ${domain}: ${err.message}`);
    return null;
  }
}

function formatContact(entry) {
  return {
    email: entry.value,
    name: [entry.first_name, entry.last_name].filter(Boolean).join(' ') || 'Unknown',
    position: entry.position || 'Unknown',
    confidence: entry.confidence || 0,
  };
}

module.exports = { findContact, extractDomain };
