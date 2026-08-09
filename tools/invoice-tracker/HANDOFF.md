# Handoff — invoice tracker, becoming a 1099 tax tool

Everything a fresh session needs. Written for a Claude running **locally on
Radislav's Windows PC**, where it can read his files and run things itself.

---

## 1. Who and what

Radislav Denisenko, cable/field technician in North Port, FL. Paid weekly by
**Koscom Networks** against an invoice PDF (`I0F8.pdf`) that Ashley Claravall
(`ashley.melissa@koscomnetworks.com`) emails every Thursday. Pay lands Friday.

He is **not a developer and not a terminal person**. His stated goal is that his
whole job is talking to Claude — he should never be handed a list of steps. Do
the work; leave him one action, not six. Read `CLAUDE.md` at the repo root for
how to talk to him; it is not optional and he wrote most of it himself.

**The product goal, in his words:** a tool that tracks what he earns *and* what
he can deduct, where capturing a receipt is so effortless he will still be doing
it in November. He has said plainly that he will abandon anything that feels like
work — *"I'm a human being with emotions, I'm gonna get lazy."* **Optimise for
him keeping the habit, not for elegance or efficiency.** A clumsier flow he
actually uses beats a clever one he drops.

---

## 2. The machine

- **Repo:** `C:\Users\radde\Portfolio`, branch `claude/invoice-job-analytics-g9gsfs`
- **Tool:** `C:\Users\radde\Portfolio\tools\invoice-tracker`
- **Python:** 3.14.7, the command is `python` (not `python3`)
- **Shell:** PowerShell. Claude Code lives at `C:\Users\radde\.local\bin\claude.exe`
- **The repo is PUBLIC on GitHub.** Nothing private may ever be committed.

Credentials live **outside the repo**: `%APPDATA%\invoice-tracker\gmail.dat`,
encrypted with Windows DPAPI so they are tied to his Windows login.
`python fetch_invoices.py --forget` erases them. `data/` and `secrets.json` are
gitignored; check `git status` before every commit.

---

## 3. What exists and works

Zero dependencies anywhere — Python standard library and plain browser APIs.

| File | Does |
|---|---|
| `fetch_invoices.py` | Gmail over IMAP, parses new invoices, writes `data/invoices.json` |
| `invoice_parser.py` | invoice semantics + arithmetic; CLI: `python invoice_parser.py file.pdf` |
| `pdf_text.py` | PDF text extraction, stdlib only |
| `tax.py` | expenses, mileage, Schedule C categories, federal tax estimate |
| `assets/pdf-extract.js` | the same PDF algorithm in the browser, for drag-and-drop |
| `index.html` + `assets/` | the dashboard |
| `test_parser.py` | the check — must print `core math OK` |
| `open-tracker.bat` | double-click: serves the dashboard, opens the browser |
| `fetch-invoices.bat` | double-click: runs the Gmail fetch |
| `README.md` | fuller reference; where it and this file differ, follow this file |

**A "job" is a distinct JOB number on a given day.** Several pay lines share one
JOB number — that is one job, not several. Money is in whole cents everywhere.

If you change `pdf_text.py`, change `assets/pdf-extract.js` to match. They are
hand-ports of each other.

### Verified reference numbers — check any re-parse against these

Week of **July 05–11, 2026**: 5 days worked (Mon, Tue, Wed, Fri, Sat — Thursday
off), 35 jobs across 61 pay lines, gross **$1,530.63**, soft fee **−$6.25**,
take home **$1,524.31**. Averages 7.0 jobs/day, $306.13/day, $43.73/job.

Two deliberate oddities, do not "fix" either:

- **The 61 lines total $1,530.63 but the invoice prints $1,530.56** — Koscom is
  7¢ light. The dashboard reports it under "Worth asking about".
- **Take home is $1,524.31, not $1,524.38** — it derives from the invoice's
  printed total, not from the summed lines.
- The CLI prints `5.97 jobs/day` for a $1,300 target where the dashboard shows
  `6.0`. Same number, different rounding. Neither is wrong.

**His real average is ~$1,107/week** before the soft fee, across all weeks — the
July 5–11 week was well above normal. Rent he is considering is $1,380/month,
which is ~40% of take-home after a tax set-aside. Tight but not impossible.

---

## 4. Tax research — findings so far

Gathered by two research agents from secondary sources (KPMG, Journal of
Accountancy, Littler, Forbes, Thomson Reuters) because irs.gov was unreachable
from the cloud container. **The load-bearing items were then verified against
primary sources from his PC on 2026-08-09** — those are marked ✅ below.
Anything not marked is still secondary-source only.

### Mileage — the big one

- ✅ **2026 has TWO rates, both confirmed on irs.gov:** **72.5¢** for Jan 1 –
  Jun 30 (IR-2025-128) and **76¢** for Jul 1 – Dec 31 (IR-2026-29), the raise
  driven by fuel prices. Medical/moving went 20.5¢ → 23.5¢; charity stayed 14¢.
  A year's miles must be split at June 30. `tax.py`'s date-keyed table was
  already correct. Source: `irs.gov/tax-professionals/standard-mileage-rates`.
  (The earlier "Notice 2026-10 / Announcement 2026-11" citations were wrong —
  irs.gov cites the IR news-release numbers above. Use those.)
- **Commuting is not deductible** (Rev. Rul. 99-7). Home → first job of the day
  is normally commuting. **Unless** his home qualifies as his principal place of
  business, in which case *every* trip from home becomes deductible.
- A vehicle is **listed property under §274(d)**, so the strict-substantiation
  rule applies: an inadequate log is **disallowed in full**, not estimated down.
  The log needs date, miles, start/end, and a *specific* business purpose,
  recorded at or near the time. Weekly counts as timely; reconstructed after an
  audit starts does not.
- **The year-one method election is irreversible.** Claim actual expenses on a
  vehicle in its first business year and it can never use standard mileage.
  Start with standard and he may switch later (straight-line depreciation only).
  Leased vehicles are locked for the whole lease. Rev. Proc. 2019-46.
- **You cannot claim standard mileage and the van's running costs in the same
  year.** `tax.py` enforces this and reports which method is worth more.

### Going paperless

**Rev. Proc. 97-22** permits scans to replace originals. Conditions: complete
and legible capture, an **index** so a specific receipt can be retrieved, ability
to **reproduce hard copies on demand**, integrity and anti-tamper controls,
backups, and periodic checks. Paper may be destroyed **only after** testing the
system and instituting procedures (§7).

**Storing only extracted data is not compliant** — discarding the image destroys
the record. **Always keep the original image.** This is a hard design rule.

Retention: **3 years** generally; **6** if income is understated by >25%;
**indefinitely** if no return is filed; and for the **van, until ~3 years after
the year he disposes of it** — potentially a decade.

### Substantiation and thresholds

- ✅ **The $75 threshold is NOT universal — settled.** Reg. §1.274-5(c)(2)(iii)
  reads: documentary evidence is required for "(1) Any expenditure for lodging
  while traveling away from home, and (2) Any other expenditure of $75 or more."
  That regulation implements **§274(d) only**, and 26 U.S.C. §274(d) covers
  exactly three things: **traveling expenses away from home (including meals and
  lodging), gifts, and listed property** (§280F(d)(4) — which is where the van
  falls). The blogs claiming it applies to all business expenses are wrong.
- **What that means for him:** most of what he buys — tools, supplies, phone,
  licences — is an ordinary §162 expense governed by **§6001**, which sets **no
  dollar floor whatsoever**. There is no small-purchase exemption for a $12 box
  of connectors. And lodging needs a receipt at **any** amount. The only place
  the $75 waiver helps him is small van and travel costs, which under standard
  mileage he isn't itemising anyway.
- **Design rule: capture everything, never build a "under $75, skip it" path.**
  `tax.py` carries this note where the categories are defined.
- **Local meals are NOT deductible.** The "sleep or rest" rule
  (*US v. Correll*) — meals count only when travel is overnight. Lunch between
  job sites is personal. `tax.py` has a meals category; it should warn.

### Worth money, commonly missed

- **Home office, simplified method:** $5/sq ft up to 300 sq ft = $1,500 max,
  Schedule C line 30. Requires **regular AND exclusive** use. The deduction
  itself is minor; what matters is that it can convert his daily commuting into
  deductible business miles. Worth more than every receipt combined.
- **Cell phone** business-use share (no longer listed property; Notice 2011-72).
- **De minimis safe harbor**, Reg. §1.263(a)-1(f): expense tools up to **$2,500
  per item** instead of depreciating — but it needs an election statement
  attached to a timely filed return. Easy to miss, must be done annually.
- Protective clothing/boots **only if unsuitable for everyday wear**.
- Licenses, certifications, business-use tolls and parking.

### Other

- **Schedule C Part IV line 47** asks, under penalty of perjury, whether he has
  written evidence for the vehicle deduction and whether it is written.
- **The 1099-NEC threshold rose from $600 to $2,000** for 2026 (OBBBA). He will
  receive fewer 1099s; the income is still fully taxable and his own books
  become the primary record. Under-reporting triggers the 6-year window.
- Florida has **no state income tax**. SE tax 15.3% on 92.35% of net earnings.
  Quarterly estimates (Form 1040-ES) if he expects to owe $1,000+.
- ✅ **2026 single-filer figures, confirmed on irs.gov** (Rev. Proc. 2025-32 as
  amended by the OBBBA): standard deduction **$16,100**; brackets 10% to
  $12,400, 12% to $50,400, 22% to $105,700, 24% to $201,775, 32% to $256,225,
  35% to $640,600, 37% above. **`tax.py` was carrying the 2025 figures** —
  fixed 2026-08-09.
- ✅ **QBI (§199A) was missing from the estimate entirely and is now in.** A sole
  proprietor deducts **20% of business profit**, capped at 20% of taxable income
  after the standard deduction — the cap is what binds at his income, not the
  20%. Made permanent by the OBBBA, with the single-filer phase-in now starting
  at $75,000 above the threshold and a new $400 minimum. He is far below any
  limit, so he gets it in full. Together with the bracket fix this cut the
  estimated set-aside on a ~$57.5k year from **$10,432 to $9,632**.

---

## 5. The receipt system — design decided, not yet built

**Capture: email to himself.** He shares a photo to email; the existing IMAP code
picks it up. Chosen because the code, the encrypted credential and the launcher
already exist and are debugged, it works on cellular anywhere, and it needs no
new app, account or sync software. Extend `pdf_attachments()` to accept
`image/*` and add a second Gmail search keyed on a subject or label.

Rejected, with reasons: **OneDrive** (Files On-Demand placeholders break Python
reads, and it sweeps in every photo he takes); **Phone Link** (cannot transfer
iPhone photos at all, no automatic folder drop); **LAN endpoint** (fails away
from home wifi, which is where receipts happen); **Syncthing** (best privacy,
but pairing device IDs is beyond his configuration budget).

**Extraction: Claude reads the images.** A local Claude Code session reads image
files directly — no API key, no cost beyond his subscription. Tesseract scores
~60% on crumpled thermal paper and is not viable. If unattended nightly runs
become worth it later, the API path is Sonnet with the Batch API at roughly
$0.60/month for 100 receipts; cost is not a decision factor either way.

**Validation: deterministic, never a self-reported confidence score.** Research
is clear that LLM self-assessed confidence is badly calibrated — models report
high confidence regardless of correctness. Use instead: line items + tax must
equal the total in whole cents; date parses and is not in the future; duplicate
detection on merchant+date+total; a known-merchant memory. Flag failures to a
review queue in the dashboard. **Always keep the original image beside the
record** — required by Rev. Proc. 97-22 and the escape hatch when extraction is
wrong.

**Categorisation: a plain rules file he can edit** (Firefly III's approach), not
per-transaction AI. "Contains WHOLEFDS → groceries" is deterministic and
debuggable.

**Do not build:** Docker, a server, a database engine, a mobile app, bank
integrations, multi-user anything.

---

## 6. Answer these before building further

1. **iPhone or Android?** Decides the one-tap share mechanism. Nothing else.
2. **Is the Koscom income 1099 or W-2?** `CLAUDE.md` says he has been a Comcast
   technician since Oct 2023, but the Koscom invoice is contractor-shaped (a
   "soft fee" deduction, nothing withheld). **This is the threshold question:**
   if any of it is W-2, none of these expenses are deductible against it — the
   deduction for unreimbursed employee expenses was permanently repealed.
3. **Does he have a space used regularly and exclusively for work at home?**
   Decides the home office, and through it whether his daily driving is
   deductible at all.
4. **Has he set aside anything for taxes this year?** Nothing is withheld from
   these invoices. If the answer is no, that matters more than the app does.
5. **Roughly how many miles does he drive in a week, and how much of that is
   home → first job?** Needed to size the deduction honestly.

Also outstanding: he is owed a **van repair reimbursement**. Ashley approved it
on 2026-07-24 saying "next week's payout"; on 2026-07-30 he said it still had not
arrived. It would appear on an invoice as its own labelled row beside `TRUCK` and
`SOFT FEE`. Check whether it ever landed.

---

## 7. Next build steps

1. ~~Verify the 2026 mileage rates and the $75 scope against irs.gov.~~ Done
   2026-08-09; see the ✅ items in section 4.
2. Extend the fetcher to pull image attachments into `data/inbox/`.
3. Receipt extraction + the deterministic validators + a review queue.
4. A tax view in the dashboard: deductions, set-aside, quarterly estimates.
5. Reconstruct mileage as far back as is honest — his invoices already give the
   exact days he worked, which is the skeleton of a log.

---

## 8. Rules

- **Never commit `secrets.json`, `data/`, or any credential.** The repo is public.
- Never ask him to paste a password into chat.
- Commit and push to `claude/invoice-job-analytics-g9gsfs`, never `main`.
- Run `python test_parser.py` before and after changes; it must print
  `core math OK`.
- **You are not a tax advisor and neither is he.** Report what sources say, mark
  what is unverified, and push him to a CPA for the two irreversible calls: the
  year-one vehicle method election and the home-office exclusive-use test.
