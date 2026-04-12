/**
 * pages/api/update-stage.js — POST /api/update-stage
 *
 * Manually sets the stage and status for a single sheet row. All other fields
 * (Draft Body, Contact info, etc.) are preserved. Used by the dashboard's
 * quick-action buttons (reset, skip, jump to targeted).
 *
 * Body: { rowNumber: number, stage: string, status: string }
 */
require('dotenv').config();
const { authorize } = require('../../src/index');
const { updateRow } = require('../../src/sheets');

const VALID_STAGES = new Set([
  'discovered', 'analyzed', 'drafted', 'contacted', 'targeted', 'gmail_drafted',
]);
const VALID_STATUSES = new Set([
  'pending', 'keep', 'skip', 'ready', 'error', 'no_contact', 'no_targets',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { rowNumber, stage, status } = req.body || {};

  if (!rowNumber)                      return res.status(400).json({ error: 'rowNumber is required' });
  if (!stage || !VALID_STAGES.has(stage))   return res.status(400).json({ error: `Invalid stage: ${stage}` });
  if (!status || !VALID_STATUSES.has(status)) return res.status(400).json({ error: `Invalid status: ${status}` });

  try {
    const auth = await authorize();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const tabName = process.env.SHEET_TAB_NAME || 'run_queue';

    // updateRow does a safe partial update — only Stage, Status, Last Updated change.
    // All other fields (Draft Body, Contact info, etc.) are preserved.
    await updateRow(auth, spreadsheetId, tabName, Number(rowNumber), {
      'Stage': stage,
      'Status': status,
      'Last Updated': new Date().toISOString(),
    });

    console.log(`[api/update-stage] row ${rowNumber} → ${stage}/${status}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[api/update-stage] error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
