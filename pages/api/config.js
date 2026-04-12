/**
 * pages/api/config.js — GET/POST /api/config
 *
 * Reads and writes ui-config.json, which stores the search queries, max results
 * per query, and any extra writing instructions set via the control page. If the
 * file does not exist, GET returns hardcoded defaults.
 */
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(process.cwd(), 'ui-config.json');

const DEFAULT_CONFIG = {
  queries: [
    'seed stage AI startup',
    'early stage AI startup 2026',
    'YC startup AI agents',
    'AI developer tools startup',
    'AI infrastructure startup seed',
    'fintech AI startup early stage',
    'consumer AI startup',
    'agentic startup seed',
  ],
  maxPerQuery: 10,
  writingInstructions: '',
};

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        // Back-fill any keys missing from older config files
        res.json({ ...DEFAULT_CONFIG, ...config });
        return;
      }
      res.json(DEFAULT_CONFIG);
    } catch {
      res.json(DEFAULT_CONFIG);
    }
  } else if (req.method === 'POST') {
    try {
      const { queries, maxPerQuery, writingInstructions } = req.body || {};
      if (!Array.isArray(queries)) {
        return res.status(400).json({ error: 'queries must be an array' });
      }
      const config = {
        queries,
        maxPerQuery: Number(maxPerQuery) || 10,
        writingInstructions: writingInstructions ?? '',
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      res.json({ success: true });
    } catch (err) {
      console.error('[api/config] error:', err.message);
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(405).end();
  }
}
