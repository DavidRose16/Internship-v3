# Internship Outreach Agent

A local Node.js script that discovers companies, researches them, finds contacts, generates personalized cold emails, saves them as Gmail drafts, and logs everything to a Google Sheet.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. API keys

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

You need:

- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com/)
- **Hunter.io API key** — get one at [hunter.io](https://hunter.io/) (free tier: 25 searches/month)

### 3. Google Cloud setup

The agent uses Gmail (to create drafts) and Google Sheets (to log results). Both require OAuth2.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use an existing one)
3. Enable the **Gmail API** and **Google Sheets API**
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Desktop app**
   - Name: anything (e.g. "Internship Agent")
5. Download the credentials JSON and save it as `credentials.json` in the project root
6. Add `http://localhost:3456/oauth2callback` as an authorized redirect URI

On first run, the script will open an auth URL. Visit it, grant access, and the token will be saved to `token.json` for future runs.

### 4. Google Sheet

Create a Google Sheet with these columns in row 1:

| Company | People at Company / Person | Communication | Type of Company | Status | Email | Deliverable |
|---------|---------------------------|---------------|-----------------|--------|-------|-------------|

Copy the sheet ID from the URL (`https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`) and add it to your `.env`.

### 5. Write your background and voice

Edit `background.md` with your real background (name, school, skills, projects, what you're looking for).

Edit `voice.md` with your email style preferences (tone, things to avoid, how you write).

Both files are read fresh every run, so you can tweak them between runs.

## Usage

### Dry run (default)

```bash
node src/index.js
```

This discovers companies, researches them, finds contacts, and generates email drafts — but does **not** create Gmail drafts or write to the sheet. Drafts are printed to the console so you can review the quality.

### Live run

```bash
DRY_RUN=false node src/index.js
```

This creates actual Gmail drafts and logs each result to your Google Sheet.

### Configuration

All settings are in `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `CATEGORIES` | `AI startups` | Comma-separated company categories |
| `MAX_COMPANIES` | `3` | Companies per run (use 3 for testing, 10-15 for real runs) |
| `DRY_RUN` | `true` | Set to `false` for live mode |
| `SHEET_TAB_NAME` | `Sheet1` | Name of the tab in your Google Sheet |

## Pipeline

```
Discover companies (Claude)
    ↓
Research each company (website fetch + Claude)
    ↓  skip if research is weak
Find contact (Hunter.io)
    ↓  log "No contact found" if none
Generate email (Claude + voice.md + background.md)
    ↓  enforce 120-word limit
Save as Gmail draft
    ↓
Log to Google Sheet
```

## Deduplication

The agent reads existing company names and email addresses from your sheet before each run. It will not create duplicate entries.

## Files

```
src/
  index.js        — main orchestrator, config, Google OAuth
  discover.js     — company discovery via Claude
  research.js     — website fetch + research summary via Claude
  contacts.js     — contact lookup via Hunter.io
  writeEmail.js   — email + subject line generation via Claude
  gmail.js        — Gmail draft creation
  sheets.js       — Google Sheets read/write
background.md     — your background (read each run)
voice.md          — your email style guide (read each run)
credentials.json  — Google OAuth credentials (you create this)
token.json        — Google OAuth token (auto-generated on first run)
.env              — API keys and settings
```
