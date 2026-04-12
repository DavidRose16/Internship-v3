/**
 * pages/index.js — Pipeline Dashboard.
 *
 * Displays all companies in the pipeline as cards, filterable by stage.
 * Each card shows research context (product, key observation, why it fits),
 * current stage/status badges, and controls to manually adjust stage/status
 * or trigger quick actions (reset, skip, jump to targeted).
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';

const STAGE_ORDER = [
  'discovered',
  'analyzed',
  'drafted',
  'contacted',
  'targeted',
  'gmail_drafted',
];

const ALL_STATUSES = ['pending', 'keep', 'skip', 'ready', 'error', 'no_contact', 'no_targets'];

function statusBadgeClass(status) {
  const map = {
    keep: 'badge-keep',
    ready: 'badge-ready',
    skip: 'badge-skip',
    error: 'badge-error',
    pending: 'badge-pending',
    no_contact: 'badge-no_contact',
    no_targets: 'badge-no_targets',
  };
  return map[status] || 'badge-pending';
}

function StageBadge({ stage, status }) {
  return (
    <span>
      <span className="badge badge-stage">{stage}</span>{' '}
      <span className={`badge ${statusBadgeClass(status)}`}>{status}</span>
    </span>
  );
}

function CompanyCard({ row, onRowUpdate }) {
  const [editStage, setEditStage]   = useState(row['Stage']  || 'discovered');
  const [editStatus, setEditStatus] = useState(row['Status'] || 'pending');
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState('');

  // Keep selects in sync if parent refreshes the row
  useEffect(() => {
    setEditStage(row['Stage']  || 'discovered');
    setEditStatus(row['Status'] || 'pending');
  }, [row['Stage'], row['Status']]);

  const isDirty = editStage !== row['Stage'] || editStatus !== row['Status'];

  async function handleSave(stageOverride, statusOverride) {
    const stage  = stageOverride  ?? editStage;
    const status = statusOverride ?? editStatus;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/update-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowNumber: row.rowNumber, stage, status }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSaveMsg('✓ saved');
      // Sync local select state if called via quickSave
      if (stageOverride  != null) setEditStage(stageOverride);
      if (statusOverride != null) setEditStatus(statusOverride);
      onRowUpdate?.(row.rowNumber, { Stage: stage, Status: status });
      setTimeout(() => setSaveMsg(''), 2500);
    } catch (err) {
      setSaveMsg(`✗ ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  function quickSave(stage, status) {
    handleSave(stage, status);
  }

  let targets = [];
  try { targets = JSON.parse(row['Send Targets'] || '[]'); } catch {}

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.3 }}>
            {row['Company'] || '—'}
          </div>
          <div style={{ color: '#6b7280', fontSize: 12 }}>{row['Domain']}</div>
        </div>
        <div style={{ flexShrink: 0 }}>
          <StageBadge stage={row['Stage']} status={row['Status']} />
        </div>
      </div>

      {/* Product / Key observation */}
      {row['Product / What They Do'] && (
        <div style={{ fontSize: 13, color: '#374151' }}>{row['Product / What They Do']}</div>
      )}
      {row['Key Observation'] && (
        <div style={{ fontSize: 12, color: '#4b5563', fontStyle: 'italic' }}>
          {row['Key Observation']}
        </div>
      )}
      {row['Why It Fits'] && (
        <div style={{ fontSize: 12, color: '#6b7280' }}>{row['Why It Fits']}</div>
      )}

      {/* Skip reason */}
      {row['Skip Reason'] && (
        <div style={{ fontSize: 12, color: '#dc2626' }}>Skip: {row['Skip Reason']}</div>
      )}

      {/* Targets */}
      {targets.length > 0 && (
        <div style={{ fontSize: 12, color: '#0070f3' }}>
          {targets.length} target{targets.length !== 1 ? 's' : ''}:{' '}
          {targets.map(t => t.name || t.email).filter(Boolean).join(', ')}
        </div>
      )}

      {/* Subject preview */}
      {row['Subject'] && (
        <div style={{ fontSize: 12, color: '#9ca3af' }}>
          Subject: <span style={{ color: '#374151' }}>{row['Subject']}</span>
        </div>
      )}

      {/* Scores */}
      {row['Fit Score'] && (
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          Fit: {row['Fit Score']}/10
          {row['Research Confidence'] && ` · confidence: ${row['Research Confidence']}`}
          {row['Writing Confidence'] && ` · writing: ${row['Writing Confidence']}`}
        </div>
      )}

      {/* Draft created */}
      {row['Draft Created'] && (
        <div style={{ fontSize: 11, color: '#9ca3af' }}>
          Draft created: {new Date(row['Draft Created']).toLocaleString()}
        </div>
      )}

      {/* ── Stage / Status controls ── */}
      <div
        style={{
          borderTop: '1px solid #e4e4e7',
          paddingTop: 8,
          marginTop: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Selects + Save row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={editStage}
            onChange={e => setEditStage(e.target.value)}
            style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff' }}
          >
            {STAGE_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select
            value={editStatus}
            onChange={e => setEditStatus(e.target.value)}
            style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff' }}
          >
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <button
            className="btn-primary btn-sm"
            onClick={() => handleSave()}
            disabled={saving || !isDirty}
            style={{ fontSize: 11 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {saveMsg && (
            <span
              style={{
                fontSize: 11,
                color: saveMsg.startsWith('✓') ? '#16a34a' : '#dc2626',
              }}
            >
              {saveMsg}
            </span>
          )}
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          <button
            className="btn-secondary btn-sm"
            onClick={() => quickSave('discovered', 'pending')}
            disabled={saving}
            style={{ fontSize: 10 }}
          >
            ↩ reset
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => quickSave('analyzed', 'skip')}
            disabled={saving}
            style={{ fontSize: 10 }}
          >
            ✗ skip
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => quickSave('targeted', 'ready')}
            disabled={saving}
            style={{ fontSize: 10 }}
          >
            → targeted
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  function fetchRows() {
    setLoading(true);
    fetch('/api/rows')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setRows(data);
        setError('');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchRows(); }, []);

  function handleRowUpdate(rowNumber, updates) {
    setRows(prev => prev.map(r =>
      r.rowNumber === rowNumber ? { ...r, ...updates } : r
    ));
  }

  const stageCounts = {};
  rows.forEach(r => {
    const s = r['Stage'] || 'unknown';
    stageCounts[s] = (stageCounts[s] || 0) + 1;
  });

  const filtered = filter === 'all' ? rows : rows.filter(r => r['Stage'] === filter);

  return (
    <div>
      <nav className="nav">
        <span className="nav-brand">Internship Pipeline</span>
        <Link href="/" className="active">Dashboard</Link>
        <Link href="/control">Control</Link>
        <Link href="/review">Review Drafts</Link>
      </nav>

      <div className="page">
        {/* Page header */}
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}
        >
          <h1 className="page-title">
            Pipeline Queue
            <span style={{ fontSize: 14, fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
              {rows.length} companies
            </span>
          </h1>
          <button className="btn-secondary btn-sm" onClick={fetchRows} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div
            className="card"
            style={{ background: '#fef2f2', borderColor: '#fecaca', marginBottom: 16, color: '#991b1b' }}
          >
            Error: {error}
          </div>
        )}

        {/* Stage filter pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          <button
            className={`pill ${filter === 'all' ? 'pill-active' : 'pill-inactive'}`}
            onClick={() => setFilter('all')}
          >
            All ({rows.length})
          </button>
          {STAGE_ORDER.map(s => {
            const count = stageCounts[s] || 0;
            return (
              <button
                key={s}
                className={`pill ${filter === s ? 'pill-active' : 'pill-inactive'}`}
                onClick={() => setFilter(s)}
              >
                {s} ({count})
              </button>
            );
          })}
        </div>

        {/* Cards */}
        {loading && (
          <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ color: '#9ca3af', textAlign: 'center', padding: 40 }}>
            No companies in this stage yet.
          </div>
        )}

        <div className="cards-grid">
          {filtered.map(row => (
            <CompanyCard
              key={row.rowNumber}
              row={row}
              onRowUpdate={handleRowUpdate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
