/**
 * pages/api/voice.js — GET/POST /api/voice
 *
 * Reads and writes voice.md, the email style guide passed to Claude as STYLE
 * NOTES during email generation. Edits made in the control page are saved here
 * and take effect on the next Write or Create Drafts run.
 */
const path = require('path');
const fs = require('fs');

const VOICE_PATH = path.join(process.cwd(), 'voice.md');

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const content = fs.readFileSync(VOICE_PATH, 'utf8');
      res.json({ content });
    } catch (err) {
      res.status(500).json({ error: `Could not read voice.md: ${err.message}` });
    }
  } else if (req.method === 'POST') {
    try {
      const { content } = req.body || {};
      if (typeof content !== 'string') {
        return res.status(400).json({ error: 'content must be a string' });
      }
      fs.writeFileSync(VOICE_PATH, content, 'utf8');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: `Could not write voice.md: ${err.message}` });
    }
  } else {
    res.status(405).end();
  }
}
