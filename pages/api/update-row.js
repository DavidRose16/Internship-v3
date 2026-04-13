/**
 * pages/api/update-row.js — POST /api/update-row
 *
 * Updates arbitrary allowed fields on a single sheet row.
 * More permissive than update-stage.js — lets the sheet UI save
 * Notes, Stage, Status, or Subject without separate endpoints.
 *
 * Body: { rowNumber: number, updates: { [field]: value } }
 * Allowed fields: Stage, Status, Notes, Subject
 */
require('dotenv').config();
const { authorizeSheets } = require('../../src/index');
const { updateRow } = require('../../src/sheets');

const ALLOWED_FIELDS = new Set(['Stage', 'Status', 'Notes', 'Subject']);

const VALID_STAGES = new Set([
  'discovered', 'analyzed', 'drafted', 'contacted', 'targeted', 'gmail_drafted',
]);
const VALID_STATUSES = new Set([
  'pending', 'keep', 'skip', 'ready', 'error', 'no_contact', 'no_targets',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { rowNumber, updates } = req.body || {};

  if (!rowNumber) return res.status(400).json({ error: 'rowNumber is required' });
  if (!updates || typeof updates !== 'object' || !Object.keys(updates).length) {
    return res.status(400).json({ error: 'updates object is required' });
  }

  // Whitelist check
  for (const key of Object.keys(updates)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return res.status(400).json({ error: `Field not editable: ${key}` });
    }
  }

  // Validate Stage/Status if present
  if (updates.Stage && !VALID_STAGES.has(updates.Stage)) {
    return res.status(400).json({ error: `Invalid stage: ${updates.Stage}` });
  }
  if (updates.Status && !VALID_STATUSES.has(updates.Status)) {
    return res.status(400).json({ error: `Invalid status: ${updates.Status}` });
  }

  try {
    const auth = await authorizeSheets();
    if (!auth) {
      return res.status(503).json({ error: 'Google Sheets auth not available.' });
    }
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const tabName = process.env.SHEET_TAB_NAME || 'run_queue';

    await updateRow(auth, spreadsheetId, tabName, Number(rowNumber), {
      ...updates,
      'Last Updated': new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[api/update-row] error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
