const Exa = require('exa-js').default;

/**
 * Normalize a domain from a URL.
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Block obvious junk / directories / list pages.
 */
function isLikelyCompanyUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();

    const blockedPathFragments = [
      '/blog',
      '/news',
      '/directory',
      '/companies/',
      '/industry/',
      '/list',
      '/top',
      '/rank',
      '/category',
      '/resources',
      '/guides',
      '/compare',
      '/startups/',
      '/library/',
      '/sites/',
      '/venture/',
    ];

    return !blockedPathFragments.some(fragment => path.includes(fragment));
  } catch {
    return false;
  }
}

/**
 * Block list-style titles.
 */
function looksLikeBadCompanyTitle(title = '') {
  const lower = title.toLowerCase();

  const blockedPatterns = [
    'startups funded by',
    'fastest growing',
    'top ',
    'best ',
    'companies and',
    'directory',
    'blog',
    'guide',
    'list of',
    'startup library',
    'consumer ai startups',
    'seed rounds are all for ai companies',
  ];

  return blockedPatterns.some(pattern => lower.includes(pattern));
}

/**
 * Block obviously wrong domains.
 */
function isBlockedDomain(domain = '') {
  const blocked = new Set([
    'workato.com',
    'getmagical.com',
    'github.com',
    'news.crunchbase.com',
    'forbes.com',
    'nextplayso.substack.com',
    'startupweekendsf.com',
  ]);

  return blocked.has(domain);
}

/**
 * Filter out service / consulting companies.
 */
function looksLikeServiceBusiness(text = '') {
  const lower = text.toLowerCase();

  const blockedPatterns = [
    'tailored solutions',
    'product and services firm',
    'consulting',
    'full-service',
    'agency',
    'services firm',
  ];

  return blockedPatterns.some(pattern => lower.includes(pattern));
}

/**
 * Filter out obviously larger / later-stage companies.
 */
function looksTooBig(text = '') {
  const lower = text.toLowerCase();

  return (
    lower.includes('series b') ||
    lower.includes('series c') ||
    lower.includes('series d') ||
    lower.includes('annual revenue') ||
    lower.includes('403 people') ||
    lower.includes('57 people') ||
    lower.includes('1063 people') ||
    lower.includes('$480.0m') ||
    lower.includes('$335.0m')
  );
}

/**
 * Filter out polluted / clearly mismatched metadata.
 */
function looksPolluted(text = '') {
  const lower = text.toLowerCase();

  const badPatterns = [
    "women's clothing boutique",
    'accounting company',
    'electrical, solar, and air-conditioning',
    '3d scanning and design studio',
    'startup weekend is a dynamic 3-day accelerator',
  ];

  return badPatterns.some(pattern => lower.includes(pattern));
}

/**
 * Bias toward interesting, technical startups.
 */
function looksInteresting(text = '') {
  const lower = text.toLowerCase();

  const goodSignals = [
    'ai',
    'agent',
    'llm',
    'developer',
    'infrastructure',
    'api',
    'platform',
    'automation',
    'model',
    'tool',
    'engine',
  ];

  return goodSignals.some(s => lower.includes(s));
}

/**
 * Clean snippet.
 */
function cleanDiscoverySnippet(text = '') {
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}

/**
 * Extract company name.
 */
function extractCompanyName(title, url) {
  if (title && title.trim() && !looksLikeBadCompanyTitle(title)) {
    return title
      .split(' | ')[0]
      .split(' - ')[0]
      .trim();
  }

  const domain = extractDomain(url);
  if (!domain) return '';
  return domain.split('.')[0];
}

/**
 * MAIN
 */
async function discoverCompanies(queries, existingDomains = new Set(), maxPerQuery = 10) {
  const exa = new Exa(process.env.EXA_API_KEY);
  const runId = Date.now().toString();

  let queuePosition = 1;
  const discovered = [];

  for (const query of queries) {
    const response = await exa.search(query, {
      category: 'company',
      type: 'auto',
      numResults: maxPerQuery,
    });

    const results = response.results || [];

    for (const result of results) {
      const sourceUrl = result.url || '';
      const sourceTitle = result.title || '';
      const domain = extractDomain(sourceUrl);
      const textBlob = `${sourceTitle} ${result.text || ''}`;

      if (!domain) continue;
      if (existingDomains.has(domain)) continue;
      if (isBlockedDomain(domain)) continue;
      if (!isLikelyCompanyUrl(sourceUrl)) continue;
      if (looksLikeBadCompanyTitle(sourceTitle)) continue;
      if (looksLikeServiceBusiness(textBlob)) continue;
      if (looksTooBig(textBlob)) continue;
      if (looksPolluted(textBlob)) continue;
      if (!looksInteresting(textBlob)) continue;

      existingDomains.add(domain);

      discovered.push({
        runId,
        queuePosition: queuePosition++,
        stage: 'discovered',
        status: 'pending',
        company: extractCompanyName(sourceTitle, sourceUrl),
        domain,
        category: 'company',
        searchQuery: query,
        sourceUrl,
        sourceTitle,
        discoverySnippet: cleanDiscoverySnippet(result.text || result.snippet || ''),
        discoveryScore: '',
        websiteSummary: '',
        productWhatTheyDo: '',
        keyObservation: '',
        whyItFits: '',
        outreachNotes: '',
        fitScore: '',
        researchConfidence: '',
        skipReason: '',
        contactName: '',
        contactRole: '',
        contactEmail: '',
        contactSource: '',
        contactConfidence: '',
        subject: '',
        draftBody: '',
        writingConfidence: '',
        draftCreated: '',
        draftId: '',
        approvedToSend: '',
        sent: '',
        lastUpdated: new Date().toISOString(),
        notes: '',
      });
    }
  }

  return discovered;
}

module.exports = { discoverCompanies };