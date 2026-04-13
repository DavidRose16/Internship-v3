import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const PIPELINE_STAGES = [
  {
    id: 'discover',
    label: 'Discover',
    queueStage: null,
    queueStatus: null,
    desc: 'Search Exa for new startups',
  },
  {
    id: 'analyze',
    label: 'Analyze',
    queueStage: 'discovered',
    queueStatus: 'pending',
    desc: 'Research and score each company with Claude',
  },
  {
    id: 'write',
    label: 'Write Emails',
    queueStage: 'analyzed',
    queueStatus: 'keep',
    desc: 'Generate personalized outreach drafts',
  },
  {
    id: 'contacts',
    label: 'Find Contacts',
    queueStage: 'drafted',
    queueStatus: 'ready',
    desc: 'Look up contact emails via Hunter.io',
  },
  {
    id: 'targets',
    label: 'Select Targets',
    queueStage: 'contacted',
    queueStatus: 'ready',
    desc: 'Pick the best contacts to reach out to',
  },
  {
    id: 'drafts',
    label: 'Create Drafts',
    queueStage: 'targeted',
    queueStatus: 'ready',
    desc: 'Push finalized drafts to Gmail',
  },
];

export default function Control() {
  // ── Config state ─────────────────────────────────────────────────────────────
  const [queries, setQueries]                       = useState('');
  const [maxPerQuery, setMaxPerQuery]               = useState(10);
  const [writingInstructions, setWritingInstructions] = useState('');
  const [savedOk, setSavedOk]                       = useState(false);
  const [saveError, setSaveError]                   = useState('');

  // ── Stage counts ──────────────────────────────────────────────────────────────
  const [stageCounts, setStageCounts] = useState({});

  // ── Run state ────────────────────────────────────────────────────────────────
  const [runningStage, setRunningStage] = useState(null);
  const [log, setLog]                   = useState([]);
  const [runId, setRunId]               = useState(null);
  const logRef = useRef(null);

  // ── Load config + counts on mount ─────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => {
        if (Array.isArray(c.queries))         setQueries(c.queries.join('\n'));
        if (c.maxPerQuery != null)             setMaxPerQuery(c.maxPerQuery);
        if (c.writingInstructions != null)     setWritingInstructions(c.writingInstructions);
      })
      .catch(() => {});

    loadCounts();
  }, []);

  function loadCounts() {
    fetch('/api/rows')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        const counts = {};
        PIPELINE_STAGES.forEach(s => {
          if (!s.queueStage) return;
          counts[s.id] = data.filter(
            r => r['Stage'] === s.queueStage && r['Status'] === s.queueStatus
          ).length;
        });
        setStageCounts(counts);
      })
      .catch(() => {});
  }

  // ── Auto-scroll log ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // ── Log polling ───────────────────────────────────────────────────────────────
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

  // ── Save settings ─────────────────────────────────────────────────────────────
  async function saveSettings() {
    setSaveError('');
    const parsedQueries = queries.split('\n').map(s => s.trim()).filter(Boolean);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: parsedQueries,
          maxPerQuery: Number(maxPerQuery),
          writingInstructions,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2500);
    } catch (err) {
      setSaveError(err.message);
    }
  }

  // ── Run a pipeline stage ──────────────────────────────────────────────────────
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

      try {
        const logRes = await fetch(`/api/logs?runId=${newRunId}`);
        if (logRes.ok) {
          const logData = await logRes.json();
          if (Array.isArray(logData.lines)) setLog(logData.lines);
        }
      } catch {}

      const data = await res.json();
      if (data.error) {
        setLog(prev => [...prev, '', `✗ Error: ${data.error}`]);
      } else {
        loadCounts(); // refresh counts after successful run
      }
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
        <Link href="/sheet">Sheet</Link>
        <Link href="/control" className="active">Control</Link>
        <Link href="/review">Review Drafts</Link>
      </nav>

      <div className="page" style={{ maxWidth: 660 }}>
        <h1 className="page-title" style={{ marginBottom: 20 }}>Pipeline Control</h1>

        {/* ── Settings ── */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 16 }}>Settings</div>

          <div className="form-row">
            <label>
              Search Queries — one per line
              <span style={{ color: '#9ca3af', fontWeight: 400, marginLeft: 6 }}>
                ({queryCount} {queryCount === 1 ? 'query' : 'queries'})
              </span>
            </label>
            <textarea
              value={queries}
              onChange={e => setQueries(e.target.value)}
              rows={6}
              style={{ fontFamily: 'monospace', fontSize: 12.5 }}
              placeholder={'seed stage AI startup\nYC startup AI agents\n…'}
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

          <div className="form-row">
            <label>Writing Instructions</label>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6 }}>
              Extra guidance passed to Claude when writing emails.
              Appended to the base style guide at runtime.
            </div>
            <textarea
              value={writingInstructions}
              onChange={e => setWritingInstructions(e.target.value)}
              rows={4}
              placeholder="e.g. Always reference a specific product detail. Keep the tone direct but warm."
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="btn-primary btn-sm"
              onClick={saveSettings}
              style={{ minWidth: 110 }}
            >
              {savedOk ? '✓ Saved' : 'Save Settings'}
            </button>
          </div>
          {saveError && (
            <div style={{ color: '#dc2626', fontSize: 12, marginTop: 6 }}>✗ {saveError}</div>
          )}
        </div>

        {/* ── Pipeline stages ── */}
        <div className="card">
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>Run Pipeline</div>

          <div>
            {PIPELINE_STAGES.map((stage, i) => {
              const count     = stageCounts[stage.id];
              const isRunning = runningStage === stage.id;
              const busy      = runningStage !== null;
              const hasQueue  = count != null && count > 0;

              return (
                <div
                  key={stage.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: '11px 0',
                    borderBottom: i < PIPELINE_STAGES.length - 1 ? '1px solid #f1f3f5' : 'none',
                  }}
                >
                  {/* Step circle */}
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: isRunning ? '#0070f3' : '#f1f5f9',
                      color: isRunning ? '#fff' : '#6b7280',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 600,
                      flexShrink: 0,
                      transition: 'background 0.2s, color 0.2s',
                    }}
                  >
                    {i + 1}
                  </div>

                  {/* Label + queue count */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{stage.label}</div>
                    <div style={{ fontSize: 11, marginTop: 1 }}>
                      {count == null ? (
                        <span style={{ color: '#9ca3af' }}>{stage.desc}</span>
                      ) : hasQueue ? (
                        <span style={{ color: '#d97706', fontWeight: 500 }}>{count} queued</span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>0 queued</span>
                      )}
                    </div>
                  </div>

                  {/* Run button */}
                  <button
                    className={isRunning ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
                    onClick={() => runStage(stage.id)}
                    disabled={busy}
                    style={{ flexShrink: 0, minWidth: 66 }}
                  >
                    {isRunning ? 'Running…' : 'Run'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Live log ── */}
        {(log.length > 0 || runningStage) && (
          <div className="card" style={{ marginTop: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>
                {runningStage
                  ? `Running ${PIPELINE_STAGES.find(s => s.id === runningStage)?.label}…`
                  : 'Run log'}
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
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 5 }}>
                Polling every 1.2 s — full output also in terminal.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
