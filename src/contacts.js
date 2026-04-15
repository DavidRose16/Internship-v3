/**
 * src/contacts.js — Email contact discovery via Hunter.io.
 *
 * Five-step pipeline per company:
 *   1. Domain search — scored and ranked; confidence < 70 and generic emails filtered out.
 *   2. Email finder — if no strong named contact (Tier 1–3) survives step 1.
 *   3. Person enrichment — top 3 candidates enriched via Hunter people/find.
 *   4. Email verification — all personal candidates verified; invalid/disposable/unknown excluded.
 *   5. Final output — only deliverable or risky contacts are eligible for Send Targets.
 */
const axios = require('axios');

const GENERIC_PREFIXES = ['info', 'hello', 'team', 'contact', 'support', 'careers', 'jobs'];
const GENERIC_LOCAL_RE = /^(info|hello|team|contact|support|careers|jobs|founders)$/i;

// Minimum Hunter confidence score to include a domain-search result
const MIN_CONFIDENCE = 70;

// Role tiers — first match wins the bonus (order matters)
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
  { re: /founder\s+assoc|brand\s+manag/i,                                                                              bonus:  5 },
];

// "Strong" = Tier 1–3 only
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

function getRoleTierBonus(role) {
  for (const { re, bonus } of ROLE_TIERS) {
    if (re.test(role || '')) return bonus;
  }
  return 0;
}

function scoreHunterEntry(entry = {}) {
  const position = entry.position || '';
  let score = Number(entry.confidence || 0);

  for (const { re, bonus } of ROLE_TIERS) {
    if (re.test(position)) { score += bonus; break; }
  }

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
    verificationStatus: 'unverified',
    verificationNote: '',
  };
}

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
    verificationStatus: 'generic',
    verificationNote: 'Generic inbox — not verified',
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
      verificationStatus: 'unverified',
      verificationNote: '',
    };
  } catch (err) {
    console.error(`  Hunter email-finder error: ${err.message}`);
    return null;
  }
}

async function runPersonEnrichment(email, apiKey) {
  if (!email || !apiKey) return null;
  try {
    const res = await axios.get('https://api.hunter.io/v2/people/find', {
      params: { email, api_key: apiKey },
      timeout: 10000,
    });
    return res.data?.data || null;
  } catch (err) {
    console.error(`  Hunter person-enrichment error for ${email}: ${err.message}`);
    return null;
  }
}

async function runEmailVerification(email, apiKey) {
  if (!email || !apiKey) return null;
  try {
    const res = await axios.get('https://api.hunter.io/v2/email-verifier', {
      params: { email, api_key: apiKey },
      timeout: 15000,
    });
    return res.data?.data || null;
  } catch (err) {
    console.error(`  Hunter email-verifier error for ${email}: ${err.message}`);
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

  // ─── STEP 1: Domain search ────────────────────────────────────────────────
  // Fetch all results, then filter: confidence >= 70 AND non-generic email only.
  const rawEntries = await runDomainSearch(domain, apiKey);

  const filteredEntries = rawEntries.filter(e => {
    const confidence = Number(e.confidence || 0);
    const localPart = (e.value || '').split('@')[0];
    if (confidence < MIN_CONFIDENCE) return false;
    if (GENERIC_LOCAL_RE.test(localPart)) return false;
    return true;
  });

  const hunterContacts = filteredEntries
    .sort((a, b) => scoreHunterEntry(b) - scoreHunterEntry(a))
    .map(formatHunterEntry);

  // ─── STEP 2: Email finder if no strong named contact from step 1 ──────────
  // Target is the top-ranked named person from ALL raw results (not filtered),
  // so a strong person with low confidence can still get a verified email found.
  let finderContact = null;
  if (!hunterContacts.some(isStrongNamedContact) && apiKey) {
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
        const existingEmails = new Set(hunterContacts.map(c => c.email.toLowerCase()));
        if (!existingEmails.has(found.email.toLowerCase())) {
          finderContact = found;
        }
      }
    }
  }

  // All personal candidates for enrichment + verification
  const personalCandidates = [
    ...hunterContacts,
    ...(finderContact ? [finderContact] : []),
  ];

  // ─── STEP 3: Person enrichment for top 3 candidates ──────────────────────
  const top3 = personalCandidates.slice(0, 3);
  for (const candidate of top3) {
    const enrichment = await runPersonEnrichment(candidate.email, apiKey);
    if (!enrichment) continue;

    // Update role if enrichment returns a better title (higher role tier)
    if (enrichment.position) {
      const currentBonus = getRoleTierBonus(candidate.role);
      const enrichedBonus = getRoleTierBonus(enrichment.position);
      if (!candidate.role || enrichedBonus > currentBonus) {
        candidate.role = enrichment.position;
      }
    }

    // Store additional enrichment context
    if (enrichment.linkedin_url) candidate.linkedinUrl = enrichment.linkedin_url;
    if (enrichment.company)      candidate.enrichedCompany = enrichment.company;
    candidate.enriched = true;
  }

  // ─── STEP 4: Email verification for all personal candidates ──────────────
  for (const candidate of personalCandidates) {
    const result = await runEmailVerification(candidate.email, apiKey);
    const status = result?.status || 'unknown';
    candidate.verificationStatus = status;

    if (status === 'deliverable') {
      candidate.verificationNote = 'verified deliverable';
      console.log(`  [VERIFY] ${candidate.email} → deliverable — included`);
    } else if (status === 'risky') {
      candidate.verificationNote = 'risky — included with warning';
      console.log(`  [VERIFY] ${candidate.email} → risky — included with warning`);
    } else if (status === 'invalid') {
      candidate.verificationNote = 'invalid — excluded';
      console.log(`  [VERIFY] ${candidate.email} → invalid — excluded`);
    } else if (status === 'disposable') {
      candidate.verificationNote = 'disposable — excluded';
      console.log(`  [VERIFY] ${candidate.email} → disposable — excluded`);
    } else {
      // 'unknown' or API failure
      candidate.verificationNote = `${status} — excluded`;
      console.log(`  [VERIFY] ${candidate.email} → ${status} — excluded`);
    }
  }

  // ─── STEP 5: Only deliverable or risky contacts are eligible ─────────────
  const verifiedCandidates = personalCandidates.filter(
    c => c.verificationStatus === 'deliverable' || c.verificationStatus === 'risky'
  );

  // Build generic contacts for record-keeping only — they never reach Send Targets
  const allEmailSet = new Set(personalCandidates.map(c => c.email.toLowerCase()));
  const genericContacts = buildGenericContacts(domain).filter(
    c => !allEmailSet.has(c.email.toLowerCase())
  );

  const allContacts = [...personalCandidates, ...genericContacts];

  // ─── Primary contact selection ────────────────────────────────────────────
  // Prefer strong (Tier 1–3) verified contacts, then any verified contact.
  let primary;

  const strongVerified = verifiedCandidates.filter(isStrongNamedContact);
  if (strongVerified.length > 0) {
    primary = strongVerified[0];
  } else if (verifiedCandidates.length > 0) {
    primary = verifiedCandidates[0];
  } else {
    primary = { email: '', name: '', role: '', source: '', confidence: '', type: '', verificationStatus: 'none' };
  }

  // ─── Verification summary for Notes column ───────────────────────────────
  const totalChecked = personalCandidates.length;
  const deliverableCount = personalCandidates.filter(c => c.verificationStatus === 'deliverable').length;
  const riskyCount = personalCandidates.filter(c => c.verificationStatus === 'risky').length;

  let verificationSummary;
  if (totalChecked === 0) {
    verificationSummary = 'No contacts found to verify.';
  } else if (verifiedCandidates.length === 0) {
    verificationSummary = 'no verified contacts found';
  } else {
    verificationSummary = `${verifiedCandidates.length}/${totalChecked} contacts passed verification (${deliverableCount} deliverable, ${riskyCount} risky).`;
  }

  return {
    primary,
    allContacts: JSON.stringify(allContacts),
    verificationSummary,
    hasVerifiedContacts: verifiedCandidates.length > 0,
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
