# Internship Outreach Pipeline

An end-to-end automation pipeline for cold outreach to early-stage startups. Discovers companies via Exa search, researches them with Claude, generates personalized cold emails, finds contacts via Hunter.io, and pushes Gmail drafts for human review — all tracked in a Google Sheet.

---

## How the Pipeline Works

Each company moves through six sequential stages. State is stored in a Google Sheet with one row per company.

```
Search     Exa search → discovered / pending
   ↓
Analyze    Claude fetches and evaluates company website → analyzed / keep or skip
   ↓
Write      Claude generates a personalized cold email → drafted / ready
   ↓
Contacts   Hunter.io finds email addresses → contacted / ready or no_contact
   ↓
Targets    Rank contacts by role tier, select up to 3 → targeted / ready
   ↓
Drafts     Gmail API creates unsent drafts → gmail_drafted / ready
   ↓
Review     Human edits and approves in the web UI → pushed to Gmail inbox
```

You can run stages individually or end-to-end, via the CLI or the web dashboard.

---

## Architecture

**Two-tier application:**

- **CLI** (`node src/index.js [stage]`) — runs pipeline stages sequentially, writes results to the Google Sheet
- **Web UI** (`npm run dev`) — Next.js dashboard for configuration, live monitoring, and draft approval

**External services:**

| Service | Purpose |
|---|---|
| Anthropic (Claude) | Company research, email generation, draft revision |
| Exa | Web search for company discovery; website text fetch |
| Hunter.io | Contact discovery (domain search + email finder) |
| Google Sheets | Pipeline state — single source of truth |
| Gmail API | Draft creation (OAuth2, never auto-sends) |

---

## Prerequisites

- Node.js 18+
- A Google Cloud project with the **Gmail API** and **Google Sheets API** enabled
- OAuth2 credentials (Desktop app type) downloaded as `credentials.json`
- API keys for Anthropic, Exa, and Hunter.io

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd internship-outreach-pipeline
npm install
```

### 2. Create Google Cloud credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or use an existing one
3. Enable the **Gmail API** and **Google Sheets API**
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
5. Choose **Desktop app** as the application type
6. Download the JSON and save it as `credentials.json` in the project root

> The redirect URI `http://localhost:3456/oauth2callback` is used automatically — no manual configuration needed in the Google Cloud console for Desktop app credentials.

### 3. Create a Google Sheet

Create a new blank Google Sheet. Copy the sheet ID from the URL — it is the alphanumeric string between `/d/` and `/edit`:

```
https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit
```

The pipeline writes the 36-column header row automatically on first run.

### 4. Set up environment variables

```bash
cp .env.example .env
```

Fill in all required keys. See [Environment Variables](#environment-variables) below.

### 5. Add your background

Copy `background.md.example` to `background.md` and fill in your own background. This file is read by Claude every time it writes an email — the more specific it is, the better the personalization.

### 6. Authorize Google OAuth (first run only)

```bash
node src/index.js discover
```

The CLI prints an authorization URL. Open it in a browser, grant access to Gmail and Sheets, and the token is saved to `token.json`. Subsequent runs reuse and auto-refresh the token.

---

## Running the Pipeline

### CLI

Run individual stages:

```bash
node src/index.js discover    # Search for new companies via Exa
node src/index.js analyze     # Research each company with Claude
node src/index.js write       # Generate personalized emails
node src/index.js contacts    # Find email contacts via Hunter.io
node src/index.js targets     # Select up to 3 send targets per company
node src/index.js drafts      # Create Gmail drafts for each target
```

Run all stages end-to-end:

```bash
node src/index.js run
```

### Web UI

```bash
npm run dev
```

Open `http://localhost:3000`. Three pages:

| Page | URL | Purpose |
|---|---|---|
| Dashboard | `/` | View all companies, filter by stage, manually adjust stage/status |
| Control | `/control` | Edit search queries and style guide, trigger stages, watch live logs |
| Review Drafts | `/review` | Edit and approve drafts — one click pushes each to Gmail |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `HUNTER_API_KEY` | Yes | — | Hunter.io API key |
| `GOOGLE_SHEET_ID` | Yes | — | ID from your Google Sheet URL |
| `EXA_API_KEY` | Yes | — | Exa search API key |
| `SHEET_TAB_NAME` | No | `run_queue` | Tab name in the Google Sheet |
| `SEARCH_QUERIES` | No | 8 built-in queries | Pipe-delimited (`\|`) Exa search terms |
| `MAX_PER_QUERY` | No | `10` | Max results per Exa query |
| `ANALYZE_LIMIT` | No | `10` | Companies to analyze per run |
| `WRITE_LIMIT` | No | `10` | Emails to write per run |
| `CONTACTS_LIMIT` | No | `10` | Contact lookups per run |
| `TARGETS_LIMIT` | No | `10` | Target selection runs per run |
| `DRAFTS_LIMIT` | No | `10` | Gmail drafts to create per run |
| `EXTRA_WRITING_INSTRUCTIONS` | No | `''` | Extra constraints appended to the email prompt |

> Per-stage limits let you process the pipeline incrementally — start with 3–5 when testing.

---

## Google Sheet Schema

The pipeline creates and manages 36 columns. The header row is written automatically.

| Column | Description |
|---|---|
| Run ID | Timestamp-based ID for the discovery batch |
| Queue Position | Order within a discovery run |
| Stage | `discovered → analyzed → drafted → contacted → targeted → gmail_drafted` |
| Status | `pending`, `keep`, `skip`, `ready`, `error`, `no_contact`, `no_targets` |
| Company | Company name extracted from the Exa result title |
| Domain | Apex domain (used for deduplication across runs) |
| Category | Always `company` (Exa search category) |
| Search Query | The Exa query that found this company |
| Source URL | Landing page from Exa result |
| Source Title | Page title from Exa result |
| Discovery Snippet | Text snippet from Exa (up to 400 chars) |
| Discovery Score | Exa relevance score |
| Website Summary | 40–70 word Claude summary of the company |
| Product / What They Do | One-sentence product description (max 20 words) |
| Key Observation | Sharp, specific insight usable in the email hook |
| Why It Fits | Why this company is a strong outreach target |
| Outreach Notes | Suggested angle for the email |
| Fit Score | 1–10 fit rating from Claude |
| Research Confidence | `low`, `medium`, or `high` |
| Skip Reason | Reason if Claude decides to skip |
| Contact Name | Primary contact full name |
| Contact Role | Primary contact job title |
| Contact Email | Primary contact email address |
| Contact Source | `hunter_domain_search`, `hunter_email_finder`, or `generic` |
| Contact Confidence | Hunter.io confidence score (0–100) |
| All Contacts | JSON array of all discovered contacts |
| Send Targets | JSON array of up to 3 selected send targets |
| Subject | Email subject line |
| Draft Body | Generated email body |
| Writing Confidence | `low`, `medium`, or `high` |
| Draft Created | ISO timestamp when Gmail draft was created |
| Draft ID | Gmail draft resource ID |
| Approved to Send | Manual flag — not automated |
| Sent | Manual flag — not automated |
| Last Updated | ISO timestamp of last pipeline write |
| Notes | Free-text notes or error messages |

---

## Project Structure

```
src/
  index.js          CLI entry point, OAuth2, stage runners, targeting logic
  discover.js       Exa search → filtered company leads
  analyze.js        Claude website research and fit evaluation
  writeEmail.js     Claude email generation and validation
  contacts.js       Hunter.io contact discovery (two-pass)
  gmail.js          Gmail draft creation via the Gmail API
  sheets.js         Google Sheets read/write operations

pages/
  index.js          Dashboard — view all companies, filter by stage
  control.js        Control — run stages, edit config, view live logs
  review.js         Review — approve drafts and push to Gmail
  _app.js           Next.js app wrapper
  api/
    pipeline.js     POST — trigger a named pipeline stage
    config.js       GET/POST — search config (ui-config.json)
    voice.js        GET/POST — voice/style guide (voice.md)
    logs.js         GET — live log polling during a run
    rows.js         GET — all sheet rows (used by dashboard and review)
    update-stage.js POST — manually set stage and status for a row
    approve.js      POST — create a Gmail draft and update the sheet
    revise.js       POST — Claude-powered email draft revision

lib/
  runLog.js         In-memory log buffer, polled by /api/logs

background.md       Your background — read by Claude when writing emails
voice.md            Email style guide — passed to Claude as STYLE NOTES
ui-config.json      Runtime UI config — auto-generated, gitignored
```

---

## Contact Discovery Logic

For each company, Hunter.io is queried in two passes:

1. **Domain search** — returns up to 10 results, scored by Hunter confidence + role tier bonus + personal/verified bonus − generic inbox penalty
2. **Email finder** — if no strong named contact (Tier 1–3 role) is found in the domain search, the top-ranked named person is passed to the email-finder endpoint for a verified address

Contacts are typed as `personal` or `generic`. Role tiers used for scoring and target selection:

| Tier | Examples | Points |
|---|---|---|
| 1 | Founder, CEO, Co-founder | 100 |
| 2 | CTO, VP Engineering, CPO, COO, Head of Research | 80 |
| 3 | ML Engineer, Research Scientist, Software Engineer | 60 |
| 4 | Product, Recruiting, Director, Operations | 40 |
| 5 | Founder Associate, Brand Manager | 20 |

Target selection picks up to 3 personal contacts ranked by role tier. A generic inbox (`team@` preferred over `careers@`, `info@`, etc.) is added only if fewer than 3 personal contacts are found.

---

## Email Generation Rules

These constraints are always enforced in `src/writeEmail.js` regardless of style guide edits:

- 120–180 words total
- No em dashes (`—`)
- No buzzwords: *innovative*, *cutting-edge*, *passionate*, *excited*
- No filler phrases: *"I wanted to reach out"*, *"I came across"*, *"super interesting"*
- No sentences longer than 25 words
- No generic praise
- Every sentence must add new information
- Do not invent facts not present in the company context

If the first draft fails validation, it is regenerated once. If the word count exceeds 180, a trim pass runs before validation.

---

## Files Not Committed

| File | Reason |
|---|---|
| `.env` | API keys and secrets |
| `credentials.json` | Google OAuth2 client secret |
| `token.json` | Auto-generated OAuth2 access token |
| `ui-config.json` | Runtime config written by the web UI |
| `.next/` | Next.js build output |
