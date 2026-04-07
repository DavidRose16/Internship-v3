require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');

const { discoverCompanies } = require('./discover');
const {
  getExistingDomains,
  appendRunQueueRows,
  getRowsByStageStatus,
  updateRow,
} = require('./sheets');
const { analyzeRow } = require('./analyze');
const { generateDraftFromRow, generateEmail, generateSubject } = require('./writeEmail');
const { createDraft } = require('./gmail');
const { findContactsForRow } = require('./contacts');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG = {
  mode: process.argv[2] || 'discover',
  analyzeLimit: parseInt(process.env.ANALYZE_LIMIT || '10', 10),
  writeLimit: parseInt(process.env.WRITE_LIMIT || '10', 10),
  contactsLimit: parseInt(process.env.CONTACTS_LIMIT || '10', 10),
  targetsLimit: parseInt(process.env.TARGETS_LIMIT || '10', 10),
  draftsLimit: parseInt(process.env.DRAFTS_LIMIT || '10', 10),
  extraWritingInstructions: process.env.EXTRA_WRITING_INSTRUCTIONS || '',
  queries: (process.env.SEARCH_QUERIES ||
    'seed stage AI startup|early stage AI startup 2026|YC startup AI agents|AI developer tools startup|AI infrastructure startup seed|fintech AI startup early stage|consumer AI startup|agentic startup seed'
  )
    .split('|')
    .map(s => s.trim())
    .filter(Boolean),
  maxPerQuery: parseInt(process.env.MAX_PER_QUERY || '10', 10),
  sheetId: process.env.GOOGLE_SHEET_ID,
  tabName: process.env.SHEET_TAB_NAME || 'run_queue',
};

const ROOT = path.join(__dirname, '..');
const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
const TOKEN_PATH = path.join(ROOT, 'token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/spreadsheets',
];

// ---------------------------------------------------------------------------
// Google OAuth2 — local redirect flow
// ---------------------------------------------------------------------------
async function authorize() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('Missing credentials.json — see README.md for setup steps.');
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_id, client_secret } =
    credentials.installed || credentials.web || {};

  const redirectUri = 'http://localhost:3456/oauth2callback';
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);

    oAuth2Client.on('tokens', (newTokens) => {
      const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }, null, 2));
    });

    return oAuth2Client;
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\nOpen this URL to authorize the app:\n');
  console.log(authUrl);
  console.log('\nWaiting for authorization on http://localhost:3456 ...\n');

  const code = await waitForAuthCode();
  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('Token saved to token.json\n');

  return oAuth2Client;
}

function waitForAuthCode() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:3456');
      const code = url.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>');
        server.close();
        resolve(code);
      } else {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing authorization code.');
      }
    });
    server.listen(3456);
    server.on('error', reject);
  });
}

async function runAnalyze(auth) {
  const rows = await getRowsByStageStatus(
    auth,
    CONFIG.sheetId,
    CONFIG.tabName,
    'discovered',
    'pending',
    CONFIG.analyzeLimit
  );

  console.log(`Found ${rows.length} rows to analyze.\n`);

  for (const row of rows) {
    const company = row.data['Company'] || '(unknown)';
    console.log(`Analyzing: ${company}`);

    try {
      const analysis = await analyzeRow(row.data);

      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Website Summary': analysis.websiteSummary || '',
        'Product / What They Do': analysis.productWhatTheyDo || '',
        'Key Observation': analysis.keyObservation || '',
        'Why It Fits': analysis.whyItFits || '',
        'Outreach Notes': analysis.outreachNotes || '',
        'Fit Score': analysis.fitScore || '',
        'Research Confidence': analysis.researchConfidence || '',
        'Skip Reason': analysis.skipReason || '',
        'Stage': 'analyzed',
        'Status': analysis.status || 'skip',
        'Last Updated': new Date().toISOString(),
      });

      console.log(`  -> ${analysis.status || 'skip'}\n`);
    } catch (err) {
      console.log(`  -> error: ${err.message}\n`);
      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Stage': 'analyzed',
        'Status': 'skip',
        'Skip Reason': `Analysis error: ${err.message}`.slice(0, 100),
        'Last Updated': new Date().toISOString(),
      });
    }
  }
}

async function runWrite(auth) {
  const rows = await getRowsByStageStatus(
    auth,
    CONFIG.sheetId,
    CONFIG.tabName,
    'analyzed',
    'keep',
    CONFIG.writeLimit
  );

  console.log(`Found ${rows.length} rows to write.\n`);

  const background = fs.readFileSync(path.join(ROOT, 'background.md'), 'utf8').trim();
  const voice = fs.readFileSync(path.join(ROOT, 'voice.md'), 'utf8').trim();

  if (!background) {
    throw new Error('background.md is empty');
  }
  if (!voice) {
    throw new Error('voice.md is empty');
  }

  for (const row of rows) {
    const company = row.data['Company'] || '(unknown)';
    console.log(`Writing: ${company}`);

    try {
      const draft = await generateDraftFromRow(
        row.data,
        background,
        voice,
        CONFIG.extraWritingInstructions
      );

      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Subject': draft.subject || '',
        'Draft Body': draft.body || '',
        'Writing Confidence': draft.writingConfidence || '',
        'Stage': 'drafted',
        'Status': 'ready',
        'Last Updated': new Date().toISOString(),
      });

      console.log('  -> ready\n');
    } catch (err) {
      console.log(`  -> error: ${err.message}\n`);
      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Writing Confidence': 'low',
        'Stage': 'drafted',
        'Status': 'error',
        'Notes': `Write error: ${err.message}`.slice(0, 120),
        'Last Updated': new Date().toISOString(),
      });
    }
  }
}

async function runContacts(auth) {
  const rows = await getRowsByStageStatus(
    auth,
    CONFIG.sheetId,
    CONFIG.tabName,
    'drafted',
    'ready',
    CONFIG.contactsLimit
  );

  console.log(`Found ${rows.length} rows to find contacts.\n`);

  for (const row of rows) {
    const company = row.data['Company'] || '(unknown)';
    console.log(`Finding contacts: ${company}`);

    try {
      const { primary, allContacts } = await findContactsForRow(row.data);

      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Contact Name': primary.name || '',
        'Contact Role': primary.role || '',
        'Contact Email': primary.email || '',
        'Contact Source': primary.source || '',
        'Contact Confidence': primary.confidence || '',
        'All Contacts': allContacts,
        'Stage': 'contacted',
        'Status': primary.email ? 'ready' : 'no_contact',
        'Last Updated': new Date().toISOString(),
      });

      console.log(`  -> ${primary.email ? 'found' : 'none'}\n`);
    } catch (err) {
      console.log(`  -> error: ${err.message}\n`);
      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Stage': 'contacted',
        'Status': 'error',
        'Notes': `Contact error: ${err.message}`.slice(0, 120),
        'Last Updated': new Date().toISOString(),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Gmail draft creation
// ---------------------------------------------------------------------------

async function runDrafts(auth) {
  const rows = await getRowsByStageStatus(
    auth,
    CONFIG.sheetId,
    CONFIG.tabName,
    'targeted',
    'ready',
    CONFIG.draftsLimit
  );

  console.log(`Found ${rows.length} rows to create drafts.\n`);

  const background = fs.readFileSync(path.join(ROOT, 'background.md'), 'utf8').trim();
  const voice = fs.readFileSync(path.join(ROOT, 'voice.md'), 'utf8').trim();

  for (const row of rows) {
    const company = row.data['Company'] || '(unknown)';
    console.log(`Creating drafts: ${company}`);

    let targets;
    try {
      targets = JSON.parse(row.data['Send Targets'] || '[]');
    } catch {
      console.log('  -> skipped (invalid Send Targets JSON)\n');
      continue;
    }

    if (!Array.isArray(targets) || targets.length === 0) {
      console.log('  -> skipped (no targets)\n');
      continue;
    }

    try {
      // Subject is company-specific — generate once and reuse across all targets
      const subject = await generateSubject(row.data);

      let firstDraftId = '';
      let draftCount = 0;

      for (const target of targets) {
        if (!target.email) continue;

        // Inject target contact info so generateEmail personalizes correctly
        const rowData = {
          ...row.data,
          'Contact Name': target.name || '',
          'Contact Role': target.role || '',
        };

        const body = await generateEmail(rowData, background, voice, CONFIG.extraWritingInstructions);
        const draft = await createDraft(auth, target.email, subject, body);

        if (!firstDraftId && draft?.id) firstDraftId = draft.id;
        draftCount++;

        console.log(`  -> draft: ${target.email}`);
      }

      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Stage': 'gmail_drafted',
        'Status': 'ready',
        'Draft ID': firstDraftId,
        'Draft Created': new Date().toISOString(),
        'Last Updated': new Date().toISOString(),
      });

      console.log(`  -> ${draftCount} draft(s) created\n`);
    } catch (err) {
      console.log(`  -> error: ${err.message}\n`);
      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Stage': 'gmail_drafted',
        'Status': 'error',
        'Notes': `Drafts error: ${err.message}`.slice(0, 120),
        'Last Updated': new Date().toISOString(),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Send target selection
// ---------------------------------------------------------------------------

// Note: "Founder Associate" is excluded from Tier 1 via negative lookahead and captured by Tier 5.
const TARGET_ROLE_TIERS = [
  // Tier 1 — founders & top exec
  { re: /co-?founder|cofounder|ceo|\bfounder(?!\s+assoc)/i,                                                           points: 100 },
  // Tier 2 — senior technical / executive leadership
  { re: /cto|chief\s+tech|vp\s*(of\s*)?eng|head\s+of\s+eng|engineering\s+lead|chief\s+product|\bcpo\b|chief\s+operat|\bcoo\b|head\s+of\s+research|research\s+lead|founding\s+eng/i, points: 80  },
  // Tier 3 — technical / research individual contributors
  { re: /machine\s+learning|research\s+eng|ai\s+research|research\s+scientist|software\s+eng|\bengineer\b/i,           points: 60  },
  // Tier 4 — recruiting / ops / product / management
  { re: /talent|recruit|people|hiring|operations|\bproduct\b|director/i,                                               points: 40  },
  // Tier 5 — low-leverage roles
  { re: /founder\s+assoc|brand\s+manag/i,                                                                              points: 20  },
];

// Preferred generic inbox order (index 0 = most preferred)
const GENERIC_PREF = ['team', 'careers', 'hello', 'info', 'contact', 'support', 'jobs'];

function scoreForTargeting(contact) {
  const role = contact.role || '';
  let rolePoints = 10; // base for personal with no matching tier (role dominates, not confidence)
  for (const { re, points } of TARGET_ROLE_TIERS) {
    if (re.test(role)) { rolePoints = points; break; }
  }
  // confidence as tiebreaker only — weight kept small so role tier always dominates
  return rolePoints + (Number(contact.confidence) || 0) * 0.1;
}

function scoreGenericContact(contact) {
  const localPart = (contact.email || '').split('@')[0].toLowerCase();
  const idx = GENERIC_PREF.indexOf(localPart);
  return idx === -1 ? -1 : GENERIC_PREF.length - idx;
}

function selectSendTargets(allContactsJson) {
  if (!allContactsJson) return [];

  let contacts;
  try {
    contacts = JSON.parse(allContactsJson);
  } catch {
    return [];
  }

  if (!Array.isArray(contacts) || contacts.length === 0) return [];

  // Deduplicate by email
  const seen = new Set();
  const unique = contacts.filter(c => {
    const key = (c.email || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Rank all personal contacts by targeting score (role tier dominates)
  const personalSorted = unique
    .filter(c => c.type === 'personal')
    .sort((a, b) => scoreForTargeting(b) - scoreForTargeting(a));

  // Take up to 3 personal contacts
  const personal = personalSorted.slice(0, 3);

  // Include a generic inbox ONLY when we have fewer than 3 personal contacts.
  //   3 personal  → use those 3, no generic
  //   2 personal  → 2 personal + 1 generic (= 3 total)
  //   1 personal  → 1 personal + 1 generic (= 2 total)
  //   0 personal  → 1 generic only
  if (personal.length >= 3) {
    return personal; // hard cap: 3 total, no generic
  }

  const bestGeneric = unique
    .filter(c => c.type === 'generic')
    .sort((a, b) => scoreGenericContact(b) - scoreGenericContact(a))[0] || null;

  const targets = [...personal];
  if (bestGeneric) targets.push(bestGeneric);

  // Safety cap — should never exceed 3 given the logic above
  return targets.slice(0, 3);
}

async function runTargets(auth) {
  const rows = await getRowsByStageStatus(
    auth,
    CONFIG.sheetId,
    CONFIG.tabName,
    'contacted',
    'ready',
    CONFIG.targetsLimit
  );

  console.log(`Found ${rows.length} rows to compute send targets.\n`);

  for (const row of rows) {
    const company = row.data['Company'] || '(unknown)';
    console.log(`Targeting: ${company}`);

    try {
      const targets = selectSendTargets(row.data['All Contacts']);

      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Send Targets': JSON.stringify(targets),
        'Stage': 'targeted',
        'Status': targets.length > 0 ? 'ready' : 'no_targets',
        'Last Updated': new Date().toISOString(),
      });

      console.log(`  -> ${targets.length} target(s)\n`);
    } catch (err) {
      console.log(`  -> error: ${err.message}\n`);
      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Stage': 'targeted',
        'Status': 'error',
        'Notes': `Targets error: ${err.message}`.slice(0, 120),
        'Last Updated': new Date().toISOString(),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Discovery-only pipeline for run_queue ingestion
// ---------------------------------------------------------------------------
async function main() {
  console.log(`=== Internship Agent: ${CONFIG.mode} ===\n`);
  console.log(`Tab:            ${CONFIG.tabName}`);
  console.log(`Queries:        ${CONFIG.queries.length}`);
  console.log(`Max/query:      ${CONFIG.maxPerQuery}`);
  console.log();

  if (!process.env.EXA_API_KEY) {
    console.error('Missing EXA_API_KEY in .env');
    process.exit(1);
  }

  if (!CONFIG.sheetId) {
    console.error('Missing GOOGLE_SHEET_ID in .env');
    process.exit(1);
  }

  const auth = await authorize();
  console.log('Google APIs authenticated.\n');

  if (CONFIG.mode === 'analyze') {
    await runAnalyze(auth);
    return;
  }
  if (CONFIG.mode === 'write') {
    await runWrite(auth);
    return;
  }
  if (CONFIG.mode === 'contacts') {
    await runContacts(auth);
    return;
  }
  if (CONFIG.mode === 'targets') {
    await runTargets(auth);
    return;
  }
  if (CONFIG.mode === 'drafts') {
    await runDrafts(auth);
    return;
  }

  let existingDomains = new Set();
  try {
    existingDomains = await getExistingDomains(auth, CONFIG.sheetId, CONFIG.tabName);
    console.log(`Found ${existingDomains.size} existing domains in ${CONFIG.tabName}.\n`);
  } catch (err) {
    console.log(`Could not read ${CONFIG.tabName} yet (${err.message}). Starting fresh.\n`);
  }

  console.log('Searching Exa...\n');
  const discovered = await discoverCompanies(CONFIG.queries, existingDomains, CONFIG.maxPerQuery);

  console.log(`Discovered ${discovered.length} new companies.\n`);

  if (!discovered.length) {
    console.log('No new companies found. Exiting.');
    return;
  }

  await appendRunQueueRows(auth, CONFIG.sheetId, CONFIG.tabName, discovered);

  console.log(`Appended ${discovered.length} rows to ${CONFIG.tabName}.\n`);
  console.log('Done.');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});