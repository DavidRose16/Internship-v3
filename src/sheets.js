const { google } = require('googleapis');

/**
 * Read company names from column A of the sheet (skipping header).
 * Used for deduplication across runs.
 */
async function getExistingCompanies(auth, spreadsheetId, tabName) {
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:A`,
  });

  const rows = res.data.values || [];
  return rows.slice(1).map(row => row[0]).filter(Boolean);
}

/**
 * Read email addresses from column F of the sheet (skipping header).
 * Used to avoid emailing the same person twice.
 */
async function getExistingEmails(auth, spreadsheetId, tabName) {
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!F:F`,
  });

  const rows = res.data.values || [];
  return rows.slice(1).map(row => row[0]).filter(Boolean);
}

/**
 * Append a row to the sheet.
 * Columns: Company | People at Company / Person | Communication | Type of Company | Status | Email | Deliverable
 *
 * @param {google.auth.OAuth2} auth
 * @param {string} spreadsheetId
 * @param {string} tabName
 * @param {string[]} rowData - array of 7 cell values
 */
async function appendRow(auth, spreadsheetId, tabName, rowData) {
  const sheets = google.sheets({ version: 'v4', auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:G`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [rowData],
    },
  });
}

module.exports = { getExistingCompanies, getExistingEmails, appendRow };
