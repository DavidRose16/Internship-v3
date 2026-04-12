// In-memory log buffer for a single active pipeline run.
// Next.js module cache keeps this singleton alive across requests in the same process.
// Single-user local tool — one run at a time is expected.

let state = {
  runId: null,
  lines: [],
  done: false,
  error: null,
};

function startRun(runId) {
  state = { runId, lines: [], done: false, error: null };
}

function appendLine(text) {
  // Preserve blank lines — they're meaningful spacing in console output
  state.lines.push(typeof text === 'string' ? text : String(text));
}

function finishRun(error) {
  state.done = true;
  state.error = error || null;
}

function getState(runId) {
  if (state.runId !== runId) return null;
  return {
    lines: [...state.lines],
    done: state.done,
    error: state.error,
  };
}

module.exports = { startRun, appendLine, finishRun, getState };
