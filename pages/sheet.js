import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const STAGE_ORDER = ['discovered', 'analyzed', 'drafted', 'contacted', 'targeted', 'gmail_drafted'];
const ALL_STATUSES = ['pending', 'keep', 'skip', 'ready', 'error', 'no_contact', 'no_targets'];

const STATUS_LEFT_BORDER = {
  keep:       '#16a34a',
  ready:      '#16a34a',
  skip:       '#ef4444',
  error:      '#ef4444',
  pending:    '#f59e0b',
  no_contact: '#d1d5db',
  no_targets: '#d1d5db',
};

const STATUS_ROW_BG = {
  keep:       'rgba(22,163,74,0.04)',
  ready:      'rgba(22,163,74,0.04)',
  skip:       'rgba(239,68,68,0.04)',
  error:      'rgba(239,68,68,0.04)',
  pending:    '#fff',
  no_contact: '#fff',
  no_targets: '#fff',
};

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60)       return 'just now';
  if (diff < 3600)     return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)    return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fitColor(score) {
  const n = parseFloat(score);
  if (!n) return '#9ca3af';
  if (n >= 8) return '#16a34a';
  if (n >= 6) return '#ca8a04';
  return '#ef4444';
}

// ── Inline-editable text cell ─────────────────────────────────────────────────
function EditableCell({ value, rowNumber, field, onSave, saving, placeholder = 'add…' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onSave(rowNumber, { [field]: draft });
  }

  function handleKey(e) {
    if (e.key === 'Enter')  commit();
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        style={{
          width: '100%', border: '1px solid #0070f3', borderRadius: 4,
          padding: '3px 6px', fontSize: 12, outline: 'none',
          boxShadow: '0 0 0 2px rgba(0,112,243,0.12)', background: '#fff',
          fontFamily: 'inherit',
        }}
      />
    );
  }

  return (
    <div
      onClick={() => !saving && setEditing(true)}
      title="Click to edit"
      style={{
        cursor: saving ? 'default' : 'text',
        minHeight: 20,
        padding: '2px 4px',
        borderRadius: 4,
        fontSize: 12,
        color: draft ? '#374151' : '#d1d5db',
        border: '1px solid transparent',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      onMouseEnter={e => { if (!saving) e.currentTarget.style.borderColor = '#e2e8f0'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; }}
    >
      {draft || <span style={{ fontStyle: 'italic', color: '#d1d5db' }}>{placeholder}</span>}
    </div>
  );
}

// ── One table row ─────────────────────────────────────────────────────────────
function SheetRow({ row, onSave, saving }) {
  const [expandDraft, setExpandDraft] = useState(false);
  const status = row['Status'] || '';

  return (
    <>
      <tr
        style={{
          background: STATUS_ROW_BG[status] || '#fff',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
        onMouseLeave={e => { e.currentTarget.style.background = STATUS_ROW_BG[status] || '#fff'; }}
      >
        {/* Company */}
        <td style={{ ...TD, borderLeft: `3px solid ${STATUS_LEFT_BORDER[status] || '#e4e4e7'}`, minWidth: 160 }}>
          <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}>
            {row['Domain'] ? (
              <a
                href={`https://${row['Domain']}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: '#111', textDecoration: 'none' }}
                onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline'; }}
                onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none'; }}
              >
                {row['Company'] || '—'}
              </a>
            ) : (row['Company'] || '—')}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 170 }}>
            {row['Domain'] || ''}
          </div>
        </td>

        {/* Stage */}
        <td style={TD}>
          <select
            value={row['Stage'] || ''}
            onChange={e => onSave(row.rowNumber, { Stage: e.target.value })}
            disabled={saving}
            style={SEL}
          >
            {STAGE_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>

        {/* Status */}
        <td style={TD}>
          <select
            value={row['Status'] || ''}
            onChange={e => onSave(row.rowNumber, { Status: e.target.value })}
            disabled={saving}
            style={SEL}
          >
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>

        {/* Fit */}
        <td style={{ ...TD, textAlign: 'center' }}>
          {row['Fit Score'] ? (
            <span style={{ fontWeight: 600, fontSize: 13, color: fitColor(row['Fit Score']) }}>
              {row['Fit Score']}
            </span>
          ) : <span style={{ color: '#d1d5db' }}>—</span>}
        </td>

        {/* Contact */}
        <td style={TD}>
          {row['Contact Name'] && (
            <div style={{ fontSize: 12, fontWeight: 500, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 195 }}>
              {row['Contact Name']}{row['Contact Role'] ? <span style={{ fontWeight: 400, color: '#9ca3af' }}> · {row['Contact Role']}</span> : null}
            </div>
          )}
          {row['Contact Email'] && (
            <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 195 }}>
              {row['Contact Email']}
            </div>
          )}
          {!row['Contact Name'] && !row['Contact Email'] && (
            <span style={{ color: '#d1d5db', fontSize: 12 }}>—</span>
          )}
        </td>

        {/* Subject */}
        <td style={TD}>
          {row['Subject'] ? (
            <div
              title={row['Subject']}
              style={{ fontSize: 12, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 230 }}
            >
              {row['Subject']}
            </div>
          ) : <span style={{ color: '#d1d5db', fontSize: 12 }}>—</span>}
        </td>

        {/* Notes */}
        <td style={TD}>
          <EditableCell
            value={row['Notes'] || ''}
            rowNumber={row.rowNumber}
            field="Notes"
            onSave={onSave}
            saving={saving}
            placeholder="add note…"
          />
        </td>

        {/* Updated + draft toggle */}
        <td style={{ ...TD, whiteSpace: 'nowrap', minWidth: 80 }}>
          {saving ? (
            <span style={{ fontSize: 11, color: '#0070f3' }}>saving…</span>
          ) : (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{formatDate(row['Last Updated'])}</span>
          )}
          {row['Draft Body'] && (
            <button
              onClick={() => setExpandDraft(v => !v)}
              style={{
                display: 'block',
                marginTop: 3,
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: 10,
                color: '#0070f3',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {expandDraft ? '▲ draft' : '▼ draft'}
            </button>
          )}
        </td>
      </tr>

      {/* Expandable draft body */}
      {expandDraft && row['Draft Body'] && (
        <tr style={{ background: '#f8fafc' }}>
          <td colSpan={8} style={{ padding: '10px 14px 14px', borderBottom: '1px solid #f1f3f5' }}>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6, fontWeight: 500 }}>
              DRAFT · {row['Company']}
              {row['Contact Email'] && <span style={{ fontWeight: 400 }}> → {row['Contact Email']}</span>}
            </div>
            <pre style={{
              fontFamily: "'SF Mono', Menlo, monospace",
              fontSize: 12,
              color: '#374151',
              whiteSpace: 'pre-wrap',
              margin: 0,
              lineHeight: 1.6,
              background: '#fff',
              border: '1px solid #e4e4e7',
              borderRadius: 6,
              padding: '10px 14px',
            }}>
              {row['Draft Body']}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const TD = {
  padding: '9px 10px',
  borderBottom: '1px solid #f1f3f5',
  verticalAlign: 'middle',
};

const SEL = {
  fontSize: 11,
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  width: '100%',
  fontFamily: 'inherit',
  outline: 'none',
};

const TH_BASE = {
  padding: '10px 10px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b7280',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  background: '#f8fafc',
  borderBottom: '2px solid #e4e4e7',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 48,
  zIndex: 10,
  userSelect: 'none',
  cursor: 'pointer',
};

const COLS = [
  { key: 'Company',      label: 'Company',  width: 190 },
  { key: 'Stage',        label: 'Stage',    width: 145 },
  { key: 'Status',       label: 'Status',   width: 120 },
  { key: 'Fit Score',    label: 'Fit',      width: 55  },
  { key: 'Contact Name', label: 'Contact',  width: 210 },
  { key: 'Subject',      label: 'Subject',  width: 250 },
  { key: 'Notes',        label: 'Notes',    width: 210 },
  { key: 'Last Updated', label: 'Updated',  width: 90  },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SheetPage() {
  const [rows, setRows]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [sortCol, setSortCol]         = useState('');
  const [sortDir, setSortDir]         = useState('asc');
  const [savingRows, setSavingRows]   = useState(new Set());

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

  async function handleSave(rowNumber, updates) {
    setSavingRows(prev => new Set([...prev, rowNumber]));
    try {
      const res = await fetch('/api/update-row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowNumber, updates }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRows(prev => prev.map(r =>
        r.rowNumber === rowNumber
          ? { ...r, ...updates, 'Last Updated': new Date().toISOString() }
          : r
      ));
    } catch (err) {
      console.error('[sheet] save error:', err.message);
    } finally {
      setSavingRows(prev => {
        const next = new Set(prev);
        next.delete(rowNumber);
        return next;
      });
    }
  }

  function toggleSort(key) {
    if (sortCol === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(key); setSortDir('asc'); }
  }

  // Filter
  let displayed = rows;
  if (stageFilter !== 'all') displayed = displayed.filter(r => r['Stage'] === stageFilter);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    displayed = displayed.filter(r =>
      (r['Company'] || '').toLowerCase().includes(q) ||
      (r['Domain'] || '').toLowerCase().includes(q) ||
      (r['Contact Email'] || '').toLowerCase().includes(q) ||
      (r['Contact Name'] || '').toLowerCase().includes(q)
    );
  }

  // Sort
  if (sortCol) {
    displayed = [...displayed].sort((a, b) => {
      if (sortCol === 'Fit Score') {
        const diff = (parseFloat(a[sortCol]) || 0) - (parseFloat(b[sortCol]) || 0);
        return sortDir === 'asc' ? diff : -diff;
      }
      if (sortCol === 'Last Updated') {
        const diff = (new Date(a[sortCol]).getTime() || 0) - (new Date(b[sortCol]).getTime() || 0);
        return sortDir === 'asc' ? diff : -diff;
      }
      const av = (a[sortCol] || '').toLowerCase();
      const bv = (b[sortCol] || '').toLowerCase();
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  const stageCounts = {};
  rows.forEach(r => { const s = r['Stage'] || 'unknown'; stageCounts[s] = (stageCounts[s] || 0) + 1; });

  // Summary stats
  const totalFit = rows.reduce((sum, r) => sum + (parseFloat(r['Fit Score']) || 0), 0);
  const withFit  = rows.filter(r => r['Fit Score']).length;
  const avgFit   = withFit ? (totalFit / withFit).toFixed(1) : '—';
  const drafted  = rows.filter(r => r['Draft Body']).length;
  const skipped  = rows.filter(r => r['Status'] === 'skip').length;

  return (
    <div>
      <nav className="nav">
        <span className="nav-brand">Internship Pipeline</span>
        <Link href="/">Dashboard</Link>
        <Link href="/sheet" className="active">Sheet</Link>
        <Link href="/control">Control</Link>
        <Link href="/review">Review Drafts</Link>
      </nav>

      <div style={{ padding: '20px 24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h1 className="page-title" style={{ marginBottom: 4 }}>
              Pipeline Sheet
              <span style={{ fontSize: 13, fontWeight: 400, color: '#9ca3af', marginLeft: 8 }}>
                {rows.length} companies
              </span>
            </h1>
            <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#6b7280' }}>
              <span>Avg fit <strong style={{ color: fitColor(avgFit) }}>{avgFit}</strong></span>
              <span><strong style={{ color: '#374151' }}>{drafted}</strong> drafted</span>
              <span><strong style={{ color: '#ef4444' }}>{skipped}</strong> skipped</span>
            </div>
          </div>
          <button className="btn-secondary btn-sm" onClick={fetchRows} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="card" style={{ background: '#fef2f2', borderColor: '#fecaca', marginBottom: 12, color: '#991b1b' }}>
            {error}
          </div>
        )}

        {/* Controls */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search company, email, domain…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: 270, padding: '6px 10px', borderRadius: 6,
              border: '1px solid #d1d5db', fontSize: 13, outline: 'none',
              fontFamily: 'inherit',
            }}
            onFocus={e => { e.target.style.borderColor = '#0070f3'; e.target.style.boxShadow = '0 0 0 2px rgba(0,112,243,0.12)'; }}
            onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none'; }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className={`pill ${stageFilter === 'all' ? 'pill-active' : 'pill-inactive'}`}
              onClick={() => setStageFilter('all')}
            >
              All ({rows.length})
            </button>
            {STAGE_ORDER.map(s => (
              <button
                key={s}
                className={`pill ${stageFilter === s ? 'pill-active' : 'pill-inactive'}`}
                onClick={() => setStageFilter(s)}
              >
                {s} ({stageCounts[s] || 0})
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto', border: '1px solid #e4e4e7', borderRadius: 8 }}>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1270 }}>
            <colgroup>
              {COLS.map(c => <col key={c.key} style={{ width: c.width }} />)}
            </colgroup>
            <thead>
              <tr>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    style={TH_BASE}
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    {sortCol === col.key && (
                      <span style={{ marginLeft: 4, color: '#0070f3', fontWeight: 700 }}>
                        {sortDir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#9ca3af', fontSize: 13 }}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && displayed.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 48, color: '#9ca3af', fontSize: 13 }}>
                    No companies found.
                  </td>
                </tr>
              )}
              {displayed.map(row => (
                <SheetRow
                  key={row.rowNumber}
                  row={row}
                  onSave={handleSave}
                  saving={savingRows.has(row.rowNumber)}
                />
              ))}
            </tbody>
          </table>
        </div>

        {displayed.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3af', textAlign: 'right' }}>
            {displayed.length} of {rows.length} rows
            {search || stageFilter !== 'all' ? ' (filtered)' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
