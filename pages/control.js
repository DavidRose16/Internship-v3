/**
 * pages/control.js — Pipeline Control Panel.
 *
 * Three sections:
 *   1. Settings — edit Exa search queries, max results per query, and the
 *      voice/style guide (voice.md). Changes are saved to ui-config.json and
 *      voice.md via /api/config and /api/voice.
 *   2. Hard rules — collapsible reference list of always-enforced email
 *      constraints that are baked into writeEmail.js and cannot be overridden
 *      by the style guide.
 *   3. Run pipeline — buttons to trigger individual stages or a full run.
 *      Console output is captured and streamed to the live log panel via
 *      /api/logs, polled every 1.2 seconds during execution.
 */
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const STAGES = [
  { id: 'discover',  label: 'Search',         desc: 'Exa search → discovered/pending' },
  { id: 'analyze',   label: 'Analyze',         desc: 'discovered/pending → analyzed' },
  { id: 'write',     label: 'Write Emails',    desc: 'analyzed/keep → drafted/ready' },
  { id: 'contacts',  label: 'Find Contacts',   desc: 'drafted/ready → contacted' },
  { id: 'targets',   label: 'Select Targets',  desc: 'contacted/ready → targeted' },
  { id: 'drafts',    label: 'Create Drafts',   desc: 'targeted/ready → gmail_drafted' },
  { id: 'run',       label: 'Run All Stages',  desc: 'Full pipeline end-to-end', primary: true },
];

// These are always enforced in the code regardless of voice.md edits.
const HARD_RULES = [
  '120–180 words total',
  'No em dashes (—)',
  'No buzzwords: innovative, cutting-edge, passionate, excited',
  'No filler: "I wanted to reach out", "I came across", "super interesting"',
  'No sentences longer than 25 words',
  'No generic praise',
  'Every sentence adds new information',
  'No subject line, no brackets, no placeholders',
  'Do not invent facts not in the company context',
];

export default function Control() {
  // ── Config state ──────────────────────────────────────────────────────────
  const [queries, setQueries]       = useState('');
  const [maxPerQuery, setMaxPerQuery] = useState(10);
  const [voiceGuide, setVoiceGuide] = useState('');   // contents of voice.md
  const [savedOk, setSavedOk]       = useState(false);
  const [saveError, setSaveError]   = useState('');
  const [showHardRules, setShowHardRules] = useState(false);

  // ── Run state ─────────────────────────────────────────────────────────────
  const [runningStage, setRunningStage] = useState(null);
  const [log, setLog]   = useState([]);
  const [runId, setRunId] = useState(null);

  const logRef  = useRef(null);

  // ── Load all settings on mount ────────────────────────────────────────────
  useEffect(() => {
    // Search config
    fetch('/api/config')
      .then(r => r.json())
      .then(c => {
        if (c.queries)    setQueries(c.queries.join('\n'));
        if (c.maxPerQuery) setMaxPerQuery(c.maxPerQuery);
      })
      .catch(() => {});

    // Voice guide (voice.md)
    fetch('/api/voice')
      .then(r => r.json())
      .then(d => { if (d.content != null) setVoiceGuide(d.content); })
      .catch(() => {});
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // ── Live log polling ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!runId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/logs?runId=${runId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.lines) && data.lines.length > 0) setLog(data.lines);
      } catch {}
    }, 1200);

    return () => clearInterval(interval);
  }, [runId]);

  // ── Save all settings ─────────────────────────────────────────────────────
  async function saveSettings() {
    setSaveError('');
    const parsedQueries = queries.split('\n').map(s => s.trim()).filter(Boolean);

    try {
      // Save search config
      const cfgRes = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: parsedQueries, maxPerQuery: Number(maxPerQuery) }),
      });
      const cfgData = await cfgRes.json();
      if (cfgData.error) throw new Error(`Config: ${cfgData.error}`);

      // Save voice guide
      const voiceRes = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: voiceGuide }),
      });
      const voiceData = await voiceRes.json();
      if (voiceData.error) throw new Error(`Voice: ${voiceData.error}`);

      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch (err) {
      setSaveError(err.message);
    }
  }

  // ── Run pipeline stage ────────────────────────────────────────────────────
  async function runStage(stageId) {
    if (runningStage) return;

    const newRunId = String(Date.now());
    setRunningStage(stageId);
    setLog([]);
    setRunId(newRunId);

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: stageId, runId: newRunId }),
      });

      // Final log fetch once the stage completes
      try {
        const logRes = await fetch(`/api/logs?runId=${newRunId}`);
        if (logRes.ok) {
          const logData = await logRes.json();
          if (Array.isArray(logData.lines)) setLog(logData.lines);
        }
      } catch {}

      const data = await res.json();
      if (data.error) setLog(prev => [...prev, '', `✗ Error: ${data.error}`]);
    } catch (err) {
      setLog(prev => [...prev, `✗ Network error: ${err.message}`]);
    } finally {
      setRunId(null);
      setRunningStage(null);
    }
  }

  const queryCount = queries.split('\n').map(s => s.trim()).filter(Boolean).length;

  return (
    <div>
      <nav className="nav">
        <span className="nav-brand">Internship Pipeline</span>
        <Link href="/">Dashboard</Link>
        <Link href="/control" className="active">Control</Link>
        <Link href="/review">Review Drafts</Link>
      </nav>

      <div className="page" style={{ maxWidth: 760 }}>
        <h1 className="page-title" style={{ marginBottom: 20 }}>Pipeline Control</h1>

        {/* ── Settings card ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Settings</div>

          {/* Search queries */}
          <div className="form-row">
            <label>
              Search Queries — one per line
              <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 6 }}>
                ({queryCount} quer{queryCount === 1 ? 'y' : 'ies'})
              </span>
            </label>
            <textarea
              value={queries}
              onChange={e => setQueries(e.target.value)}
              rows={8}
              style={{ fontFamily: 'monospace', fontSize: 12.5 }}
              placeholder="seed stage AI startup&#10;YC startup AI agents&#10;…"
            />
          </div>

          <div className="form-row" style={{ maxWidth: 160 }}>
            <label>Max results per query</label>
            <input
              type="number"
              value={maxPerQuery}
              onChange={e => setMaxPerQuery(e.target.value)}
              min={1}
              max={50}
            />
          </div>

          {/* Divider */}
          <hr style={{ border: 0, borderTop: '1px solid #e4e4e7', margin: '18px 0' }} />

          {/* Voice guide */}
          <div className="form-row">
            <label>Voice &amp; Style Guide</label>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
              This is the full style guide passed to Claude as{' '}
              <code style={{ fontSize: 11 }}>STYLE NOTES</code> when writing emails
              (contents of <code style={{ fontSize: 11 }}>voice.md</code>).
              Edit here and save — the next Write or Create Drafts run will use the updated version.
            </div>
            <textarea
              value={voiceGuide}
              onChange={e => setVoiceGuide(e.target.value)}
              rows={24}
              style={{ fontFamily: 'monospace', fontSize: 12.5, lineHeight: 1.55 }}
              placeholder="Loading voice.md…"
            />
          </div>

          {/* Hard rules toggle */}
          <div style={{ marginBottom: 16 }}>
            <button
              className="btn-secondary btn-sm"
              onClick={() => setShowHardRules(v => !v)}
              style={{ fontSize: 11 }}
            >
              {showHardRules ? '▾' : '▸'} Always-enforced rules (hardcoded in writeEmail.js)
            </button>
            {showHardRules && (
              <ul
                style={{
                  marginTop: 8,
                  paddingLeft: 20,
                  fontSize: 12,
                  color: '#6b7280',
                  lineHeight: 1.7,
                  background: '#f8fafc',
                  border: '1px solid #e4e4e7',
                  borderRadius: 6,
                  padding: '10px 10px 10px 28px',
                }}
              >
                {HARD_RULES.map(r => <li key={r}>{r}</li>)}
              </ul>
            )}
          </div>

          {/* Save */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn-primary btn-sm" onClick={saveSettings}>
              {savedOk ? '✓ Saved' : 'Save Settings'}
            </button>
            <span style={{ fontSize: 12, color: '#9ca3af' }}>
              Saves search config to ui-config.json and style guide to voice.md.
            </span>
          </div>
          {saveError && (
            <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>✗ {saveError}</div>
          )}
        </div>

        {/* ── Run pipeline card ── */}
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Run Pipeline</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            {STAGES.map(s => (
              <button
                key={s.id}
                className={s.primary ? 'btn-primary' : 'btn-secondary'}
                onClick={() => runStage(s.id)}
                disabled={runningStage !== null}
                title={s.desc}
              >
                {runningStage === s.id ? `Running ${s.label}…` : s.label}
              </button>
            ))}
          </div>

          {/* Stage reference */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 5 }}>Stage reference:</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '3px 12px',
                fontSize: 11,
                color: '#6b7280',
              }}
            >
              {STAGES.filter(s => s.id !== 'run').map(s => (
                <React.Fragment key={s.id}>
                  <span style={{ fontWeight: 500, color: '#374151' }}>{s.label}</span>
                  <span>{s.desc}</span>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Live log */}
          {(log.length > 0 || runningStage) && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {runningStage ? 'Live log (updating…)' : 'Run log'}
                </span>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setLog([])}
                  disabled={!!runningStage}
                >
                  Clear
                </button>
              </div>
              <div className="log-output" ref={logRef}>
                {log.length > 0 ? log.join('\n') : '…waiting for output…'}
              </div>
              {runningStage && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 5 }}>
                  UI polls every ~1.2 s. Full output also in the terminal.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
