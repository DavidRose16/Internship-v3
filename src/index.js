require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');
const { discoverCompanies } = require('./discover');
const { researchCompany } = require('./research');
const { findContact, extractDomain } = require('./contacts');
const { generateEmail, generateSubject } = require('./writeEmail');
const { createDraft } = require('./gmail');
const { getExistingCompanies, getExistingEmails, appendRow } = require('./sheets');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG = {
  categories: (process.env.CATEGORIES || 'AI startups').split(',').map(s => s.trim()),
  maxCompanies: parseInt(process.env.MAX_COMPANIES || '3', 10),
  dryRun: process.env.DRY_RUN !== 'false', // default true for safety
  sheetId: process.env.GOOGLE_SHEET_ID,
  tabName: process.env.SHEET_TAB_NAME || 'Sheet1',
  hunterApiKey: process.env.HUNTER_API_KEY,
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

  // Reuse saved token
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);

    // Persist refreshed tokens automatically
    oAuth2Client.on('tokens', (newTokens) => {
      const current = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      fs.writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...newTokens }, null, 2));
    });

    return oAuth2Client;
  }

  // First-time auth: open browser, capture code via local server
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

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Internship Outreach Agent ===\n');
  console.log(`Mode:           ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Categories:     ${CONFIG.categories.join(', ')}`);
  console.log(`Max companies:  ${CONFIG.maxCompanies}`);
  console.log();

  // Load voice + background fresh each run
  const background = fs.readFileSync(path.join(ROOT, 'background.md'), 'utf8');
  const voice = fs.readFileSync(path.join(ROOT, 'voice.md'), 'utf8');

  if (!background.trim()) {
    console.error('Error: background.md is empty. Fill it in before running.');
    process.exit(1);
  }
  if (!voice.trim()) {
    console.error('Error: voice.md is empty. Fill it in before running.');
    process.exit(1);
  }

  // Authenticate Google APIs
  const auth = await authorize();
  console.log('Google APIs authenticated.\n');

  // Read existing entries for deduplication
  let existingCompanies = [];
  let existingEmails = [];
  try {
    existingCompanies = await getExistingCompanies(auth, CONFIG.sheetId, CONFIG.tabName);
    existingEmails = await getExistingEmails(auth, CONFIG.sheetId, CONFIG.tabName);
    console.log(`Sheet has ${existingCompanies.length} existing companies.\n`);
  } catch (err) {
    console.log(`Could not read sheet (${err.message}). Proceeding without dedup.\n`);
  }

  // Step 1 — Discover companies
  console.log('Discovering companies...');
  let companies;
  try {
    companies = await discoverCompanies(CONFIG.categories, existingCompanies, CONFIG.maxCompanies);
  } catch (err) {
    console.error('Discovery failed:', err.message);
    process.exit(1);
  }
  console.log(`Found ${companies.length} companies.\n`);

  // Step 2-6 — Process each company
  const results = { drafted: 0, skipped: 0, noContact: 0 };
  const runDate = new Date().toISOString().split('T')[0];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`[${i + 1}/${companies.length}] ${company.name} (${company.category})`);

    // Research
    console.log('  Researching...');
    let research;
    try {
      research = await researchCompany(company, background);
    } catch (err) {
      console.log(`  Research error: ${err.message}. Skipping.`);
      results.skipped++;
      continue;
    }

    if (!research) {
      console.log('  Skipped — research too weak for a quality email.');
      results.skipped++;
      continue;
    }
    console.log(`  ${research.description.slice(0, 80)}...`);

    // Find contact
    const domain = extractDomain(company.website);
    console.log(`  Finding contacts at ${domain}...`);
    const contact = await findContact(domain, CONFIG.hunterApiKey);

    if (!contact) {
      console.log('  No contact found.');
      results.noContact++;
      if (!CONFIG.dryRun) {
        await appendRow(auth, CONFIG.sheetId, CONFIG.tabName, [
          company.name,
          'No contact found',
          '',
          company.category,
          'No Contact Found',
          '',
          '',
        ]);
      }
      continue;
    }

    // Dedup by email
    if (existingEmails.includes(contact.email)) {
      console.log(`  Skipped — ${contact.email} already in sheet.`);
      results.skipped++;
      continue;
    }

    console.log(`  Contact: ${contact.name} (${contact.position}) — ${contact.email}`);

    // Generate email
    console.log('  Generating email...');
    const emailBody = await generateEmail(company, research, contact, background, voice);
    const subject = await generateSubject(company, research);
    const wordCount = emailBody.split(/\s+/).length;
    console.log(`  Draft ready — ${wordCount} words, subject: "${subject}"`);

    if (CONFIG.dryRun) {
      console.log();
      console.log('  ┌─ DRAFT PREVIEW ─────────────────────────────');
      console.log(`  │ To:      ${contact.email}`);
      console.log(`  │ Subject: ${subject}`);
      console.log('  │');
      emailBody.split('\n').forEach(line => console.log(`  │ ${line}`));
      console.log('  └──────────────────────────────────────────────');
      console.log();
    } else {
      // Create Gmail draft
      console.log('  Creating Gmail draft...');
      await createDraft(auth, contact.email, subject, emailBody);
      console.log('  Draft created in Gmail.');

      // Log to sheet
      await appendRow(auth, CONFIG.sheetId, CONFIG.tabName, [
        company.name,
        `${contact.name}, ${contact.position}`,
        subject,
        company.category,
        `Draft Created — ${runDate}`,
        contact.email,
        'Gmail Draft',
      ]);
      console.log('  Logged to sheet.');

      existingEmails.push(contact.email);
    }

    results.drafted++;
  }

  // Summary
  console.log('\n=== Run Complete ===');
  console.log(`Drafts:      ${results.drafted}`);
  console.log(`Skipped:     ${results.skipped}`);
  console.log(`No contact:  ${results.noContact}`);
  if (CONFIG.dryRun) {
    console.log('\nThis was a dry run. Set DRY_RUN=false to create drafts and log to sheet.');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
