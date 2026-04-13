/**
 * pages/api/approve.js — POST /api/approve
 *
 * Creates a Gmail draft for a single approved contact, then updates the sheet
 * row to stage=gmail_drafted / status=ready. Called by the review page when the
 * user clicks "Approve → Gmail Draft" on a target card.
 *
 * Body: { rowNumber, targetEmail, targetName, targetRole, subject, body }
 */
require('dotenv').config();
const { authorize } = require('../../src/index');
const { createDraft } = require('../../src/gmail');
const { updateRow } = require('../../src/sheets');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { rowNumber, targetEmail, targetName, targetRole, subject, body } = req.body || {};

  if (!targetEmail || !body) {
    return res.status(400).json({ error: 'targetEmail and body are required' });
  }

  try {
    const auth = await authorize();
    if (!auth) {
      return res.status(503).json({ error: 'credentials.json not found. See README for Google Cloud setup.' });
    }

    const draft = await createDraft(auth, targetEmail, subject || 'Internship', body);
    const draftId = draft?.id || '';

    // Update sheet row to reflect draft creation
    if (rowNumber) {
      const spreadsheetId = process.env.GOOGLE_SHEET_ID;
      const tabName = process.env.SHEET_TAB_NAME || 'run_queue';
      await updateRow(auth, spreadsheetId, tabName, rowNumber, {
        'Draft ID': draftId,
        'Draft Created': new Date().toISOString(),
        'Stage': 'gmail_drafted',
        'Status': 'ready',
        'Last Updated': new Date().toISOString(),
      });
    }

    console.log(`[api/approve] Draft created for ${targetEmail} — draftId: ${draftId}`);
    res.json({ success: true, draftId });
  } catch (err) {
    console.error('[api/approve] error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
