/**
 * pages/api/rows.js — GET /api/rows
 *
 * Fetches all rows from the pipeline Google Sheet and returns them as an array
 * of objects keyed by column header. Each object includes a rowNumber field
 * (1-based, matching the sheet row) used for subsequent update calls.
 *
 * Used by the dashboard and the review page.
 */
require('dotenv').config();
const { authorize } = require('../../src/index');
const { getSheetRows } = require('../../src/sheets');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const auth = await authorize();
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const tabName = process.env.SHEET_TAB_NAME || 'run_queue';

    if (!spreadsheetId) {
      return res.status(500).json({ error: 'GOOGLE_SHEET_ID not configured in .env' });
    }

    const rawRows = await getSheetRows(auth, spreadsheetId, tabName);

    if (!rawRows.length) return res.json([]);

    const headers = rawRows[0];
    const rows = rawRows.slice(1).map((row, i) => {
      const obj = { rowNumber: i + 2 };
      headers.forEach((h, idx) => {
        obj[h] = row[idx] !== undefined ? row[idx] : '';
      });
      return obj;
    });

    res.json(rows);
  } catch (err) {
    console.error('[api/rows] error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
