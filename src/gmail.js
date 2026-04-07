const { google } = require('googleapis');

/**
 * Create a Gmail draft (does not send).
 *
 * @param {google.auth.OAuth2} auth - authenticated OAuth2 client
 * @param {string} to - recipient email address
 * @param {string} subject - email subject
 * @param {string} body - plain-text email body
 * @returns {Promise<object>} the created draft resource
 */
async function createDraft(auth, to, subject, body) {
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = buildRawMessage(to, subject, body);

  const response = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: { raw },
    },
  });

  return response.data;
}

/**
 * Build a base64url-encoded RFC 2822 message.
 */
function buildRawMessage(to, subject, body) {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

module.exports = { createDraft };
