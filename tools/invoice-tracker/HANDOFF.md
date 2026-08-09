# Handoff — finish pulling Radislav's invoices

Paste-and-go context for a fresh Claude session running **locally on the user's
Windows PC**. Everything here is verified, not assumed.

## The machine

- **Repo:** `C:\Users\radde\Portfolio` — a real git clone, currently on branch
  `claude/invoice-job-analytics-g9gsfs`. Do the work there.
- **Tool:** `C:\Users\radde\Portfolio\tools\invoice-tracker`
- **Shell:** Windows PowerShell. Use `python` (not `python3`); it is 3.14.7.
- **Git:** installed and working.
- The user is not a terminal person. Give one paste-ready block at a time, and
  say what he should expect to see. Do not make him choose between options.

## What the tool is

Parses the weekly Koscom invoice PDF (`I0F8.pdf`) that Ashley Claravall
(`ashley.melissa@koscomnetworks.com`) emails every Thursday, and reports jobs a
day, pay a day, days worked, and how many jobs a day it takes to hit a target.

Zero dependencies — Python standard library only, and plain browser APIs.

| File | Does |
|---|---|
| `fetch_invoices.py` | logs into Gmail over IMAP, parses new invoices, writes `data/invoices.json` |
| `invoice_parser.py` | invoice semantics + arithmetic; also a CLI (`python invoice_parser.py file.pdf`) |
| `pdf_text.py` | PDF text extraction, stdlib only |
| `assets/pdf-extract.js` | the same algorithm in the browser, for drag-and-drop |
| `index.html` | the dashboard |
| `test_parser.py` | the check — run this to prove nothing is broken |
| `open-tracker.bat` | double-click: serves the dashboard and opens the browser |
| `fetch-invoices.bat` | double-click: runs the Gmail fetch |

**A "job" is a distinct JOB number on a given day.** Several pay lines share one
JOB number — those are one job, not several. Money is handled in whole cents.

## The job to finish

7 invoice emails exist. Only 1 has been parsed so far. Pull the other 6.

```powershell
cd C:\Users\radde\Portfolio\tools\invoice-tracker
git pull
python test_parser.py
python fetch_invoices.py
```

`test_parser.py` must print `core math OK` before anything else. If it does not,
stop and fix that first.

### The one thing that has already gone wrong twice

`fetch_invoices.py` asks for a Gmail **App Password** (16 letters, from
<https://myaccount.google.com/apppasswords>, needs 2-Step Verification on). The
prompt hides the paste, so **he pasted it twice and got 32 characters**, and
Gmail answered `[AUTHENTICATIONFAILED] Invalid credentials`.

The script now prints the character count immediately:

- `Got 16 characters — that is the right shape.` → good
- `! Got 32 characters` → pasted twice; Ctrl+C, delete `secrets.json`, redo

If a stale bad password is already saved, delete it first:

```powershell
del secrets.json
```

Tell him to paste **once** and that the blank screen is normal.

### If Gmail still refuses

1. It must be an App Password, not his account password.
2. IMAP must be on: Gmail → Settings → See all settings → Forwarding and
   POP/IMAP → Enable IMAP → Save Changes.
3. Delete `secrets.json` and re-enter.

A network failure (rather than a credential one) says
`Could not reach imap.gmail.com` and is about VPN/firewall/port 993, not the
password.

## Reference numbers — use these to check your parse

The week of **July 05–11, 2026** is already verified. If you re-parse it and get
anything different, your parse is wrong:

- 5 days worked (Mon, Tue, Wed, Fri, Sat — Thursday off)
- 35 jobs across 61 pay lines
- Gross **$1,530.63** · soft fee **-$6.25** · take home **$1,524.31**
- Averages: 7.0 jobs/day · $306.13/day · $43.73/job
- To take home $1,300 over 5 days: **6.0 jobs a day**

**The 7¢ discrepancy is real and expected.** The 61 lines total $1,530.63 but the
invoice prints $1,530.56. That is Koscom's arithmetic, not a bug here — the
dashboard reports it under "Worth asking about". Do not "fix" it.

The other 6 weeks are: WK07.18, WK07.04, WK06.27, WK06.20, WK06.13, WK06.06
(2026). Nothing older exists.

## Then show him the numbers

```powershell
python -m http.server 8080
```

and open <http://localhost:8080/>. Or just double-click `open-tracker.bat`.

Worth telling him once it works:
- his true average jobs/day across all 7 weeks, not just the one
- whether 6-day weeks actually pay proportionally more than 5-day weeks
- how many of the 7 weeks cleared $1,300
- whether the van reimbursement he is owed ever appeared as a line item —
  Ashley approved it on 2026-07-24 saying "next week's payout", and on 2026-07-30
  he replied it still had not arrived. It would show up as its own labelled row
  next to `TRUCK` and `SOFT FEE`.

## Rules

- **Never commit `secrets.json` or `data/`.** Both are gitignored. The repo is
  **public**. Check `git status` before any commit.
- Never print the app password, and never ask him to paste it into chat — it
  goes only into the script's hidden prompt.
- Commit and push to `claude/invoice-job-analytics-g9gsfs`, not `main`.
- If you change `pdf_text.py`, change `assets/pdf-extract.js` to match. They are
  ports of each other.
