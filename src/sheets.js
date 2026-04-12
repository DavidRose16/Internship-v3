/**
 * src/sheets.js — Google Sheets read/write operations.
 *
 * Defines the 36-column pipeline schema (RUN_QUEUE_HEADERS) and exposes helpers
 * to append new company rows, query rows by stage/status, and update individual
 * rows in place without overwriting unrelated fields.
 *
 * All functions accept a google.auth.OAuth2 client — call authorize() from
 * src/index.js first to obtain one.
 */
const { google } = require('googleapis');

const RUN_QUEUE_HEADERS = [
  'Run ID',
  'Queue Position',
  'Stage',
  'Status',
  'Company',
  'Domain',
  'Category',
  'Search Query',
  'Source URL',
  'Source Title',
  'Discovery Snippet',
  'Discovery Score',
  'Website Summary',
  'Product / What They Do',
  'Key Observation',
  'Why It Fits',
  'Outreach Notes',
  'Fit Score',
  'Research Confidence',
  'Skip Reason',
  'Contact Name',
  'Contact Role',
  'Contact Email',
  'Contact Source',
  'Contact Confidence',
  'All Contacts',
  'Send Targets',
  'Subject',
  'Draft Body',
  'Writing Confidence',
  'Draft Created',
  'Draft ID',
  'Approved to Send',
  'Sent',
  'Last Updated',
  'Notes',
];

function companyToRunQueueRow(company) {
  return [
    company.runId || '',
    company.queuePosition || '',
    company.stage || '',
    company.status || '',
    company.company || '',
    company.domain || '',
    company.category || '',
    company.searchQuery || '',
    company.sourceUrl || '',
    company.sourceTitle || '',
    company.discoverySnippet || '',
    company.discoveryScore || '',
    company.websiteSummary || '',
    company.productWhatTheyDo || '',
    company.keyObservation || '',
    company.whyItFits || '',
    company.outreachNotes || '',
    company.fitScore || '',
    company.researchConfidence || '',
    company.skipReason || '',
    company.contactName || '',
    company.contactRole || '',
    company.contactEmail || '',
    company.contactSource || '',
    company.contactConfidence || '',
    company.allContacts || '',
    company.sendTargets || '',
    company.subject || '',
    company.draftBody || '',
    company.writingConfidence || '',
    company.draftCreated || '',
    company.draftId || '',
    company.approvedToSend || '',
    company.sent || '',
    company.lastUpdated || '',
    company.notes || '',
  ];
}

async function getSheetRows(auth, spreadsheetId, tabName) {
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A:AJ`,
  });

  return res.data.values || [];
}

async function getExistingDomains(auth, spreadsheetId, tabName) {
  const rows = await getSheetRows(auth, spreadsheetId, tabName);
  return new Set(
    rows
      .slice(1)
      .map(row => (row[5] || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

async function ensureRunQueueHeaders(auth, spreadsheetId, tabName) {
  const sheets = google.sheets({ version: 'v4', auth });
  const rows = await getSheetRows(auth, spreadsheetId, tabName);

  if (rows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [RUN_QUEUE_HEADERS],
      },
    });
  }
}

async function appendRunQueueRows(auth, spreadsheetId, tabName, companies) {
  if (!companies.length) return;

  const sheets = google.sheets({ version: 'v4', auth });

  await ensureRunQueueHeaders(auth, spreadsheetId, tabName);

  const rows = companies.map(companyToRunQueueRow);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:AJ`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: rows,
    },
  });
}

function mapRows(rows) {
  const headers = rows[0] || [];
  return rows.slice(1).map((row, i) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] || '';
    });
    return {
      rowNumber: i + 2,
      data: obj,
    };
  });
}

async function getRowsByStageStatus(auth, spreadsheetId, tabName, stage, status, limit = 10) {
  const rows = await getSheetRows(auth, spreadsheetId, tabName);
  const mapped = mapRows(rows);

  return mapped
    .filter(r => r.data['Stage'] === stage && r.data['Status'] === status)
    .slice(0, limit);
}

async function updateRow(auth, spreadsheetId, tabName, rowNumber, updates) {
  const sheets = google.sheets({ version: 'v4', auth });

  const existingRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!A${rowNumber}:AJ${rowNumber}`,
  });

  const existingRow = existingRes.data.values?.[0] || new Array(RUN_QUEUE_HEADERS.length).fill('');
  const row = new Array(RUN_QUEUE_HEADERS.length).fill('');

  for (let i = 0; i < RUN_QUEUE_HEADERS.length; i++) {
    row[i] = existingRow[i] || '';
  }

  Object.entries(updates).forEach(([key, value]) => {
    const colIndex = RUN_QUEUE_HEADERS.indexOf(key);
    if (colIndex !== -1) {
      row[colIndex] = value;
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A${rowNumber}:AJ${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [row],
    },
  });
}

module.exports = {
  RUN_QUEUE_HEADERS,
  getSheetRows,
  getExistingDomains,
  appendRunQueueRows,
  getRowsByStageStatus,
  updateRow,
};
