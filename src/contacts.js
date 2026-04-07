const axios = require('axios');

const GENERIC_PREFIXES = ['info', 'hello', 'team', 'contact', 'support', 'careers', 'jobs'];

// Regex for generic email local-parts (applies to both detection and scoring)
const GENERIC_LOCAL_RE = /^(info|hello|team|contact|support|careers|jobs|founders)$/i;

// Role tiers used for scoring Hunter entries (order matters — first match wins the bonus).
// Note: "Founder Associate" is excluded from Tier 1 via negative lookahead and captured by Tier 5.
const ROLE_TIERS = [
  // Tier 1 — founders & top exec
  { re: /co-?founder|cofounder|ceo|\bfounder(?!\s+assoc)/i,                                                           bonus: 50 },
  // Tier 2 — senior technical / executive leadership
  { re: /cto|chief\s+tech|vp\s*(of\s*)?eng|head\s+of\s+eng|engineering\s+lead|chief\s+product|\bcpo\b|chief\s+operat|\bcoo\b|head\s+of\s+research|research\s+lead|founding\s+eng/i, bonus: 40 },
  // Tier 3 — technical / research individual contributors
  { re: /machine\s+learning|research\s+eng|ai\s+research|research\s+scientist|software\s+eng|\bengineer\b/i,           bonus: 30 },
  // Tier 4 — recruiting / ops / product / management
  { re: /talent|recruit|people|hiring|operations|\bproduct\b|director/i,                                               bonus: 20 },
  // Tier 5 — low-leverage roles
  { re: /founder\s+assoc|brand\s+manag/i,                                                                              bonus: 5  },
];

// "Strong" means Tier 1–3 only (founder/exec/technical). Tier 4–5 are not considered strong.
const STRONG_ROLE_RE = new RegExp(
  ROLE_TIERS.slice(0, 3).map(t => t.re.source).join('|'),
  'i'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return (url || '')
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .toLowerCase();
  }
}

function scoreHunterEntry(entry = {}) {
  const position = entry.position || '';
  const localPart = (entry.value || '').split('@')[0] || '';
  let score = Number(entry.confidence || 0);

  for (const { re, bonus } of ROLE_TIERS) {
    if (re.test(position)) { score += bonus; break; }
  }

  if (GENERIC_LOCAL_RE.test(localPart)) score -= 15;
  if (entry.type === 'personal') score += 10;
  if (entry.verified) score += 10;

  return score;
}

function formatHunterEntry(entry) {
  const localPart = (entry.value || '').split('@')[0];
  return {
    email: entry.value || '',
    name: [entry.first_name, entry.last_name].filter(Boolean).join(' ').trim(),
    role: entry.position || '',
    source: 'hunter_domain_search',
    confidence: String(entry.confidence || ''),
    type: GENERIC_LOCAL_RE.test(localPart) ? 'generic' : 'personal',
  };
}

// A strong named contact: real name, non-generic email, relevant role
function isStrongNamedContact(contact) {
  if (!contact.name || !contact.name.trim()) return false;
  if (GENERIC_LOCAL_RE.test((contact.email || '').split('@')[0])) return false;
  return STRONG_ROLE_RE.test(contact.role || '');
}

function buildGenericContacts(domain) {
  if (!domain) return [];
  return GENERIC_PREFIXES.map(prefix => ({
    email: `${prefix}@${domain}`,
    name: '',
    role: prefix,
    source: 'generic',
    confidence: 'low',
    type: 'generic',
  }));
}

// ---------------------------------------------------------------------------
// Hunter API calls
// ---------------------------------------------------------------------------

async function runDomainSearch(domain, apiKey) {
  if (!domain || !apiKey) return [];
  try {
    const res = await axios.get('https://api.hunter.io/v2/domain-search', {
      params: { domain, api_key: apiKey, limit: 10 },
      timeout: 10000,
    });
    return res.data?.data?.emails || [];
  } catch (err) {
    console.error(`  Hunter domain-search error for ${domain}: ${err.message}`);
    return [];
  }
}

async function runEmailFinder(domain, firstName, lastName, role, apiKey) {
  if (!domain || !firstName || !lastName || !apiKey) return null;
  try {
    const res = await axios.get('https://api.hunter.io/v2/email-finder', {
      params: {
        domain,
        first_name: firstName,
        last_name: lastName,
        api_key: apiKey,
      },
      timeout: 10000,
    });
    const data = res.data?.data;
    if (!data?.email) return null;
    return {
      email: data.email,
      name: [firstName, lastName].join(' ').trim(),
      role: role || '',
      source: 'hunter_email_finder',
      confidence: String(data.score || ''),
      type: 'personal',
    };
  } catch (err) {
    console.error(`  Hunter email-finder error: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function findContactsForRow(rowData) {
  const sourceUrl = rowData['Source URL'] || '';
  const existingDomain = rowData['Domain'] || '';
  const domain = existingDomain || extractDomain(sourceUrl);
  const apiKey = process.env.HUNTER_API_KEY;

  // --- Pass 1: domain-search ---
  const rawEntries = await runDomainSearch(domain, apiKey);
  const hunterContacts = rawEntries
    .sort((a, b) => scoreHunterEntry(b) - scoreHunterEntry(a))
    .map(formatHunterEntry);

  // --- Pass 2: email-finder if no strong named contact from domain-search ---
  let finderContact = null;
  if (!hunterContacts.some(isStrongNamedContact) && apiKey) {
    // Pick the most relevant named person from domain-search raw data
    const target = rawEntries
      .filter(e => e.first_name && e.last_name)
      .sort((a, b) => scoreHunterEntry(b) - scoreHunterEntry(a))[0];

    if (target) {
      const found = await runEmailFinder(
        domain,
        target.first_name,
        target.last_name,
        target.position || '',
        apiKey
      );
      if (found) {
        // Skip if domain-search already has this exact email
        const existingEmails = new Set(hunterContacts.map(c => c.email.toLowerCase()));
        if (!existingEmails.has(found.email.toLowerCase())) {
          finderContact = found;
        }
      }
    }
  }

  // --- Merge all contacts ---
  const allEmailSet = new Set([
    ...hunterContacts.map(c => c.email.toLowerCase()),
    ...(finderContact ? [finderContact.email.toLowerCase()] : []),
  ]);

  const genericContacts = buildGenericContacts(domain).filter(
    c => !allEmailSet.has(c.email.toLowerCase())
  );

  const allContacts = [
    ...hunterContacts,
    ...(finderContact ? [finderContact] : []),
    ...genericContacts,
  ];

  // --- Primary selection ---
  // Priority: strong named (domain-search) > email-finder > best domain-search > generic (prefer team@) > fallback
  let primary;

  const strongContacts = hunterContacts.filter(isStrongNamedContact);
  if (strongContacts.length > 0) {
    primary = strongContacts[0]; // already sorted best-first
  } else if (finderContact) {
    primary = finderContact;
  } else if (hunterContacts.length > 0) {
    primary = hunterContacts[0];
  } else if (domain) {
    primary = genericContacts.find(c => c.role === 'team') || genericContacts[0] || {
      email: `team@${domain}`,
      name: '',
      role: 'team',
      source: 'fallback',
      confidence: 'low',
      type: 'generic',
    };
  } else {
    primary = { email: '', name: '', role: '', source: '', confidence: '', type: '' };
  }

  return {
    primary,
    allContacts: JSON.stringify(allContacts),
  };
}

// Kept for backwards compatibility / external callers
async function findContact(domain, apiKey) {
  const raw = await runDomainSearch(domain, apiKey);
  if (!raw.length) return null;
  return formatHunterEntry(
    raw.sort((a, b) => scoreHunterEntry(b) - scoreHunterEntry(a))[0]
  );
}

module.exports = {
  findContact,
  findContactsForRow,
  extractDomain,
};
