/**
 * src/index.js — CLI entry point and pipeline orchestrator.
 *
 * Handles Google OAuth2 authorization, reads config from .env and ui-config.json,
 * and exports each pipeline stage as a function. Run individual stages with:
 *
 *   node src/index.js [discover|analyze|write|contacts|targets|drafts|run]
 *
 * Also imported by the Next.js API routes so the web UI can trigger stages.
 */
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

// process.cwd() is the project root both for the CLI and for Next.js API routes.
// __dirname is unreliable when webpack bundles this module.
const ROOT = process.cwd();
const CREDENTIALS_PATH = path.join(ROOT, 'credentials.json');
const TOKEN_PATH = path.join(ROOT, 'token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/spreadsheets',
];

// ---------------------------------------------------------------------------
// Google auth — two modes for Sheets, one for Gmail
// ---------------------------------------------------------------------------

/**
 * authorizeSheets() — returns a Google auth client for Sheets access.
 *
 * Priority:
 *   1. GOOGLE_SERVICE_ACCOUNT_KEY env var (deployed demo — service account JSON)
 *   2. credentials.json on disk (local dev — OAuth2 flow, same as authorize())
 *   3. Neither present — returns null without crashing
 */
async function authorizeSheets() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    return new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  if (fs.existsSync(CREDENTIALS_PATH)) {
    return authorize();
  }

  return null;
}

async function authorize() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    return null;
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
      const { primary, allContacts, verificationSummary, hasVerifiedContacts } = await findContactsForRow(row.data);

      const status = hasVerifiedContacts ? 'ready' : 'no_contact';
      const notes = hasVerifiedContacts ? verificationSummary : 'no verified contacts found';

      await updateRow(auth, CONFIG.sheetId, CONFIG.tabName, row.rowNumber, {
        'Contact Name': primary.name || '',
        'Contact Role': primary.role || '',
        'Contact Email': primary.email || '',
        'Contact Source': primary.source || '',
        'Contact Confidence': primary.confidence || '',
        'All Contacts': allContacts,
        'Notes': notes,
        'Stage': 'contacted',
        'Status': status,
        'Last Updated': new Date().toISOString(),
      });

      console.log(`  -> ${status} — ${verificationSummary}\n`);
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

  // Only verified (deliverable) or risky contacts. Never generic, never unverified.
  const eligible = unique.filter(c =>
    c.type === 'personal' &&
    (c.verificationStatus === 'deliverable' || c.verificationStatus === 'risky')
  );

  // Rank by targeting score (role tier dominates), cap at 3
  return eligible
    .sort((a, b) => scoreForTargeting(b) - scoreForTargeting(a))
    .slice(0, 3);
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
// Discovery stage
// ---------------------------------------------------------------------------
async function runDiscover(auth) {
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
    console.log('No new companies found. Skipping append.');
    return;
  }

  await appendRunQueueRows(auth, CONFIG.sheetId, CONFIG.tabName, discovered);
  console.log(`Appended ${discovered.length} rows to ${CONFIG.tabName}.\n`);
}

// ---------------------------------------------------------------------------
// Full pipeline: run all stages sequentially
// ---------------------------------------------------------------------------
async function runAll(auth) {
  const stages = [
    { name: 'search',   fn: runDiscover },
    { name: 'analyze',  fn: runAnalyze },
    { name: 'write',    fn: runWrite },
    { name: 'contacts', fn: runContacts },
    { name: 'targets',  fn: runTargets },
    { name: 'drafts',   fn: runDrafts },
  ];

  for (const { name, fn } of stages) {
    console.log(`\n${'─'.repeat(48)}`);
    console.log(`  Stage: ${name}`);
    console.log(`${'─'.repeat(48)}\n`);
    await fn(auth);
  }

  console.log('\n=== run complete ===\n');
}

// ---------------------------------------------------------------------------
// Entry point
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

  const auth = await authorizeSheets();
  if (!auth) {
    console.error('No Google auth available. Set GOOGLE_SERVICE_ACCOUNT_KEY or provide credentials.json.');
    process.exit(1);
  }
  console.log('Google APIs authenticated.\n');

  if (CONFIG.mode === 'analyze') { await runAnalyze(auth);  return; }
  if (CONFIG.mode === 'write')   { await runWrite(auth);    return; }
  if (CONFIG.mode === 'contacts'){ await runContacts(auth); return; }
  if (CONFIG.mode === 'targets') { await runTargets(auth);  return; }
  if (CONFIG.mode === 'drafts')  { await runDrafts(auth);   return; }
  if (CONFIG.mode === 'run')     { await runAll(auth);      return; }

  // Default: discover (also handles explicit "discover" mode)
  await runDiscover(auth);
  console.log('Done.');
}

if (require.main === module) {
  main().catch(err => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
  });
}

module.exports = {
  authorize,
  authorizeSheets,
  runDiscover,
  runAnalyze,
  runWrite,
  runContacts,
  runTargets,
  runDrafts,
  runAll,
  CONFIG,
};