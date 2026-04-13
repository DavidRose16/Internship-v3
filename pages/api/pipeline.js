/**
 * pages/api/pipeline.js — POST /api/pipeline
 *
 * Triggers a named pipeline stage from the web UI. Before running, merges any
 * saved ui-config.json settings into the shared CONFIG object so the latest
 * search queries and writing instructions are always used.
 *
 * Console output is intercepted and forwarded to the in-memory runLog buffer so
 * the control page can poll it live via /api/logs.
 *
 * Body: { stage: string, runId: string }
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');

const {
  authorizeSheets,
  runDiscover,
  runAnalyze,
  runWrite,
  runContacts,
  runTargets,
  runDrafts,
  runAll,
  CONFIG,
} = require('../../src/index');

const runLog = require('../../lib/runLog');

const UI_CONFIG_PATH = path.join(process.cwd(), 'ui-config.json');

function loadUIConfig() {
  try {
    return JSON.parse(fs.readFileSync(UI_CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// Apply all ui-config.json settings to the shared CONFIG object.
// Called before every stage so fresh values are always used.
function applyUIConfig() {
  const uiConfig = loadUIConfig();
  if (!uiConfig) return;
  if (Array.isArray(uiConfig.queries) && uiConfig.queries.length > 0) {
    CONFIG.queries = uiConfig.queries;
  }
  if (uiConfig.maxPerQuery != null) {
    CONFIG.maxPerQuery = Number(uiConfig.maxPerQuery);
  }
  // Writing instructions — if set in UI config, override the env-var default
  if (uiConfig.writingInstructions != null) {
    CONFIG.extraWritingInstructions = uiConfig.writingInstructions;
  }
}

const STAGE_MAP = {
  discover: runDiscover,
  analyze:  runAnalyze,
  write:    runWrite,
  contacts: runContacts,
  targets:  runTargets,
  drafts:   runDrafts,
  run:      runAll,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { stage, runId } = req.body || {};

  if (!stage || !STAGE_MAP[stage]) {
    return res.status(400).json({
      error: `Unknown stage: ${stage}. Valid: ${Object.keys(STAGE_MAP).join(', ')}`,
    });
  }

  // Always read fresh config before any stage
  applyUIConfig();

  // Set up in-memory log buffer for this run
  if (runId) {
    runLog.startRun(runId);
  }

  // Intercept console output so the UI can poll it.
  // Restores originals in finally — safe for single-user sequential runs.
  const origLog   = console.log;
  const origError = console.error;

  function capture(...args) {
    const line = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ');
    if (runId) runLog.appendLine(line);
    return line;
  }

  console.log = (...args) => {
    origLog(...args);
    capture(...args);
  };
  console.error = (...args) => {
    origError(...args);
    const line = capture(...args);
    // Surface errors visually in the log
    if (runId && !line.startsWith('✗')) runLog.appendLine(`✗ ${line}`);
  };

  console.log(`[pipeline] Starting stage: ${stage}`);

  try {
    const auth = await authorizeSheets();
    if (!auth) {
      if (runId) runLog.finishRun('Google Sheets auth not available');
      return res.status(503).json({ error: 'Google Sheets auth not available. Set GOOGLE_SERVICE_ACCOUNT_KEY or provide credentials.json.' });
    }
    await STAGE_MAP[stage](auth);

    console.log(`[pipeline] ✓ Stage "${stage}" completed.`);
    if (runId) runLog.finishRun(null);

    res.json({ success: true, message: `Stage "${stage}" completed.` });
  } catch (err) {
    console.error(`[pipeline/${stage}] error:`, err.message);
    if (runId) runLog.finishRun(err.message);

    res.status(500).json({ error: err.message });
  } finally {
    console.log  = origLog;
    console.error = origError;
  }
}
