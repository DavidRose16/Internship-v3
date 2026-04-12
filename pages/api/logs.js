/**
 * pages/api/logs.js — GET /api/logs?runId=<id>
 *
 * Returns buffered console output for the active pipeline run. The control page
 * polls this endpoint every ~1.2 seconds while a stage is running. Returns an
 * empty response with notFound=true if the runId does not match the current run.
 */
const { getState } = require('../../lib/runLog');

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { runId } = req.query;
  if (!runId) return res.status(400).json({ error: 'runId required' });

  const state = getState(runId);
  if (!state) {
    // runId doesn't match the current run (stale or not started yet)
    return res.json({ lines: [], done: false, error: null, notFound: true });
  }

  res.json(state);
}
