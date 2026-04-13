/**
 * pages/review.js — Draft Review and Approval.
 *
 * Lists all companies in the targeted/ready state that have a draft body. For
 * each company, up to 3 target contacts are shown with editable draft bodies.
 *
 * Each target card supports:
 *   - Direct editing of the email body
 *   - Claude-powered revision via a free-text instruction (calls /api/revise)
 *   - One-click approval: creates a Gmail draft and updates the sheet row
 *     to stage=gmail_drafted (calls /api/approve)
 *   - Skip: dismisses the card without creating a draft
 *
 * Completed companies (gmail_drafted) can be toggled visible.
 */
import { useState, useEffect } from 'react';
import Link from 'next/link';

// ── Helpers ───────────────────────────────────────────────────────────────────

// A row needs review if it has a draft body and send targets, and hasn't been sent yet.
function isActionable(row) {
  return (
    row['Stage'] !== 'gmail_drafted' &&
    row['Draft Body'] &&
    row['Send Targets'] &&
    row['Send Targets'] !== '[]'
  );
}

// A row is completed if it has already been pushed to Gmail.
function isCompleted(row) {
  return (
    row['Stage'] === 'gmail_drafted' &&
    row['Send Targets'] &&
    row['Send Targets'] !== '[]' &&
    row['Draft Body']
  );
}

// ── Individual target draft card ──────────────────────────────────────────────

function TargetDraftCard({ row, target, initialBody, subject }) {
  const [body, setBody]             = useState(initialBody || '');
  const [instruction, setInstruction] = useState('');
  const [isRevising, setIsRevising] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [cardStatus, setCardStatus] = useState('pending'); // pending | approved | skipped
  const [draftId, setDraftId]       = useState(null);
  const [errorMsg, setErrorMsg]     = useState('');

  async function handleRevise() {
    const inst = instruction.trim();
    if (!inst) return;
    setIsRevising(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          instruction: inst,
          company:          row['Company'],
          contactName:      target.name,
          contactRole:      target.role,
          productWhatTheyDo: row['Product / What They Do'],
          keyObservation:   row['Key Observation'],
          whyItFits:        row['Why It Fits'],
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBody(data.body);
      setInstruction('');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsRevising(false);
    }
  }

  async function handleApprove() {
    setIsApproving(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rowNumber:   row.rowNumber,
          targetEmail: target.email,
          targetName:  target.name,
          targetRole:  target.role,
          subject:     subject || 'Internship',
          body,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDraftId(data.draftId);
      setCardStatus('approved');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsApproving(false);
    }
  }

  const isApproved = cardStatus === 'approved';
  const isSkipped  = cardStatus === 'skipped';

  if (isSkipped) {
    return (
      <div
        className="target-card skipped"
        style={{ fontSize: 13, color: '#9ca3af', padding: '10px 14px' }}
      >
        Skipped — {target.name || target.email}
        <button
          className="btn-secondary btn-sm"
          style={{ marginLeft: 12 }}
          onClick={() => setCardStatus('pending')}
        >
          Undo
        </button>
      </div>
    );
  }

  return (
    <div className={`target-card${isApproved ? ' approved' : ''}`}>
      {/* ── Contact header ── */}
      <div
        style={{
          background: isApproved ? '#f0fdf4' : '#f8fafc',
          border: `1px solid ${isApproved ? '#bbf7d0' : '#e4e4e7'}`,
          borderRadius: 6,
          padding: '10px 14px',
          marginBottom: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111', marginBottom: 2 }}>
            {target.name || '(No name)'}
          </div>
          {target.role && (
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 3 }}>{target.role}</div>
          )}
          <div style={{ fontSize: 13, color: '#0070f3', fontFamily: 'monospace' }}>
            {target.email}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
            {target.type} · confidence: {target.confidence}
          </div>
        </div>

        {isApproved && (
          <div style={{ color: '#16a34a', fontSize: 13, fontWeight: 600, textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
            ✓ Draft in Gmail
            {draftId && (
              <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                id: {draftId.slice(0, 10)}…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subject */}
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
        Subject: <strong style={{ color: '#374151' }}>{subject || 'Internship'}</strong>
      </div>

      {/* Draft body */}
      <div style={{ marginBottom: 10 }}>
        <label style={{ marginBottom: 4 }}>Draft Body</label>
        <textarea
          className="email-body"
          value={body}
          onChange={e => !isApproved && setBody(e.target.value)}
          readOnly={isApproved}
          style={{ minHeight: 180 }}
        />
      </div>

      {/* Revise + approve buttons */}
      {!isApproved && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="Instruction: make sharper / less flattering / more direct…"
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !isRevising && handleRevise()}
              style={{ flex: 1 }}
            />
            <button
              className="btn-secondary btn-sm"
              onClick={handleRevise}
              disabled={isRevising || !instruction.trim()}
              style={{ flexShrink: 0 }}
            >
              {isRevising ? 'Revising…' : 'Revise'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-success btn-sm"
              onClick={handleApprove}
              disabled={isApproving || !body.trim()}
            >
              {isApproving ? 'Creating draft…' : '✓ Approve → Gmail Draft'}
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => setCardStatus('skipped')}
            >
              Skip
            </button>
          </div>
        </>
      )}

      {errorMsg && (
        <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>Error: {errorMsg}</div>
      )}
    </div>
  );
}

// ── Company review section ────────────────────────────────────────────────────

function CompanyReviewSection({ row, dimmed }) {
  let targets = [];
  try { targets = JSON.parse(row['Send Targets'] || '[]'); } catch {}

  const draftBody = row['Draft Body'] || '';
  const subject   = row['Subject']    || 'Internship';
  const completed = row['Stage'] === 'gmail_drafted';

  return (
    <div
      className="card"
      style={{
        marginBottom: 24,
        opacity: dimmed ? 0.65 : 1,
        borderColor: completed ? '#bbf7d0' : undefined,
      }}
    >
      {/* Company header */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>
            {row['Company']}
            {completed && (
              <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500, marginLeft: 8 }}>
                ✓ already in Gmail
              </span>
            )}
          </div>
          <div style={{ color: '#6b7280', fontSize: 13 }}>{row['Domain']}</div>
        </div>
        <div>
          <span className="badge badge-stage">{row['Stage']}</span>{' '}
          <span className="badge badge-ready">{row['Status']}</span>
        </div>
      </div>

      {/* Company context */}
      {(row['Product / What They Do'] || row['Key Observation'] || row['Why It Fits']) && (
        <div className="context-block" style={{ marginBottom: 16 }}>
          {row['Product / What They Do'] && (
            <p><strong>What they do:</strong> {row['Product / What They Do']}</p>
          )}
          {row['Key Observation'] && (
            <p><strong>Observation:</strong> {row['Key Observation']}</p>
          )}
          {row['Why It Fits'] && (
            <p><strong>Why it fits:</strong> {row['Why It Fits']}</p>
          )}
        </div>
      )}

      {targets.length === 0 && (
        <div style={{ color: '#9ca3af', fontSize: 13 }}>No send targets found.</div>
      )}

      {targets.length > 0 && !draftBody && (
        <div style={{ color: '#9ca3af', fontSize: 13 }}>No draft body found.</div>
      )}

      {targets.length > 0 && draftBody && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#374151' }}>
            {targets.length} Target{targets.length !== 1 ? 's' : ''}
          </div>
          {targets.map((target, i) => (
            <TargetDraftCard
              key={target.email || i}
              row={row}
              target={target}
              initialBody={draftBody}
              subject={subject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Review page ───────────────────────────────────────────────────────────────

export default function Review() {
  const [allRows, setAllRows]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [showCompleted, setShowCompleted] = useState(false);

  function fetchRows() {
    setLoading(true);
    setError('');
    fetch('/api/rows')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setAllRows(data);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchRows(); }, []);

  const actionable = allRows.filter(isActionable);
  const completed  = allRows.filter(isCompleted);

  // What to render
  const visible = showCompleted
    ? [...actionable, ...completed]
    : actionable;

  return (
    <div>
      <nav className="nav">
        <span className="nav-brand">Internship Pipeline</span>
        <Link href="/">Dashboard</Link>
        <Link href="/sheet">Sheet</Link>
        <Link href="/control">Control</Link>
        <Link href="/review" className="active">Review Drafts</Link>
      </nav>

      <div className="page-narrow">
        {/* Header row */}
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}
        >
          <h1 className="page-title">
            Draft Review
            <span style={{ fontSize: 14, fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>
              {actionable.length} pending
              {completed.length > 0 && (
                <span style={{ color: '#16a34a', marginLeft: 6 }}>
                  · {completed.length} completed
                </span>
              )}
            </span>
          </h1>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {completed.length > 0 && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 12,
                  color: '#6b7280',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={showCompleted}
                  onChange={e => setShowCompleted(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                Show completed
              </label>
            )}
            <button className="btn-secondary btn-sm" onClick={fetchRows} disabled={loading}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            className="card"
            style={{ background: '#fef2f2', borderColor: '#fecaca', marginBottom: 16, color: '#991b1b' }}
          >
            Error: {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>Loading…</div>
        )}

        {/* Empty state */}
        {!loading && !error && actionable.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
            <div style={{ fontSize: 15, marginBottom: 8 }}>No drafts pending review.</div>
            <div style={{ fontSize: 13 }}>
              {completed.length > 0
                ? `${completed.length} compan${completed.length === 1 ? 'y' : 'ies'} already pushed to Gmail.`
                : <>Run the pipeline through the <Link href="/control">Targets stage</Link>, then come back here.</>
              }
            </div>
          </div>
        )}

        {/* Rows */}
        {visible.map(row => (
          <CompanyReviewSection
            key={row.rowNumber}
            row={row}
            dimmed={showCompleted && isCompleted(row)}
          />
        ))}
      </div>
    </div>
  );
}
