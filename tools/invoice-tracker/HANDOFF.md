# Handoff — invoice tracker, becoming a 1099 tax tool

Everything a fresh session needs. Written for a Claude running **locally on
Radislav's Windows PC**, where it can read his files and run things itself.

---

## 0. READ FIRST — two facts that were wrong everywhere until 2026-08-09

**It is KOSCOM, never Comcast.** He dictates by voice and "Koscom" transcribed
as "Comcast". That error reached `CLAUDE.md`, `README.md` and — for months —
**the live portfolio site**, which told every recruiter he worked for a company
he has never worked for. All four fixed. He has been at **Koscom Networks since
Oct 2023**, one employer the whole time.

**He was a W-2 EMPLOYEE at Koscom until roughly May 2026, and a 1099 contractor
since.** Proved from his 2025 return, not assumed: total income $24,465, total
tax $873. Less the 2025 standard deduction of $15,750 leaves $8,715 taxable, at
10% = $871.50 against the $873 shown — a $1.50 table-rounding gap. Had that been
self-employment income, SE tax **alone** would have been $3,457. So 2025 carried
no self-employment income at all, and $1,699 was withheld from wages.

### ⚠️ Therefore: possible worker misclassification, and it is worth real money

Same employer, same job, **still driving Koscom's van**, but reclassified from
employee to contractor around May 2026. The IRS common-law factors that point at
*employee* here:

- **They provide the vehicle** — the primary tool of the trade is not his.
- **They reimburse its repairs** (the `TRUCK` adjustment line) — he does not
  bear the cost of the equipment.
- **He did the identical job as a W-2 employee weeks earlier.** Nothing about
  the work changed, only the paperwork. This is the strongest single fact.
- A **`TRAINING` adjustment of $400.00** appears on one invoice. Companies train
  employees; contractors arrive trained.
- Work is dispatched to him as numbered jobs; he works for them exclusively.

If he is in fact an employee, he owes the **7.65% employee share** rather than
**15.3% self-employment tax** — roughly **$1,900 a year** on his current profit.
The mechanism is **Form SS-8** (worker-status determination) and **Form 8919**
(uncollected Social Security and Medicare tax on wages).

**Do not push him into this.** The IRS sends Koscom a copy of an SS-8. It is his
only source of income, he is about to move and buy a vehicle, and losing the job
would cost far more than $1,900. Present it as a real option with a real risk and
let him decide — with a professional, not with us.

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
| `fetch_invoices.py` | Gmail over IMAP: invoice PDFs → `data/invoices.json`, receipt photos → `data/inbox/` + `data/receipts.json` |
| `invoice_parser.py` | invoice semantics + arithmetic; CLI: `python invoice_parser.py file.pdf` |
| `pdf_text.py` | PDF text extraction, stdlib only |
| `tax.py` | expenses, mileage, Schedule C categories, federal tax estimate |
| `receipts.py` | receipt extraction queue + deterministic validators + filing |
| `receipt-rules.txt` | merchant → category, plain text, his to edit (gitignored, regenerates) |
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

## 4b. Deep verification, 2026-08-09 — five positions, each attacked twice

Five research agents against primary sources, then two adversaries per finding
(a hostile examiner and a CPA who has to sign it). **Everything below is quoted
from the statute, the regulation, the ruling or the publication itself.** Where
the first pass was wrong, the correction is what is recorded.

### ✅ The home office converts the commute — and he may qualify ALREADY

Rev. Rul. 99-7 holding (3), verbatim from `irs.gov/pub/irs-drop/rr-99-7.pdf`:
"If a taxpayer's residence is the taxpayer's principal place of business within
the meaning of § 280A(c)(1)(A), the taxpayer may deduct daily transportation
expenses incurred in going between the residence and another work location …
regardless of whether the other work location is regular or temporary and
**regardless of the distance**."

§280A(c)(1) flush language (Taxpayer Relief Act of 1997 §932, enacted to
override *Commissioner v. Soliman*, 506 U.S. 168) reaches a place used for
"administrative or management activities … if there is no other fixed location
of such trade or business **where the taxpayer conducts substantial
administrative or management activities**". Pub 587's own Example 1 is a
self-employed plumber whose work is nearly all at customers' homes and whose
home office still qualifies. He is a textbook match.

**The correction that matters:** the first pass assumed a room in a shared house
fails the exclusive-use test. **It probably does not.** Pub 587: "To qualify
under the exclusive use test, you must use a **specific area** of your home only
for your trade or business," and "The space does not need to be marked off by a
permanent partition." The unit is an *area*, not a room and not a lease. The
shared kitchen and living room are irrelevant; his private room is his.
**So the question is a fact, not a legal call: has that desk been used only for
work, with no gaming and no personal use?** If yes, the home legs are deductible
from the day he started. If no, they are not, and nothing is lost by asking.

**Time-critical:** the evidence for that claim is packed into a box in a few
weeks. Photograph and measure the CURRENT desk *before* the move.

### ✅ The mileage log is far simpler than an address-by-address reconstruction

Pub 463's delivery-route example, verbatim: "You can satisfy the requirements by
recording **the length of the delivery route once**, the date of each trip at or
near the time of the trips, and the total miles you drove the car during the tax
year." And: "You make deliveries at several different locations on a route that
begins and ends at your employer's business premises … You can account for these
using **a single record of miles driven**."

**He does not need leg-by-leg service addresses.** He needs distance + date +
business purpose, and his invoices already supply date and purpose. That is why
the odometer design below works.

Two further corrections to the received wisdom:

- **§274(d) is NOT all-or-nothing for the year.** It operates per element per
  use. *Delima* (the case usually cited for total disallowance) actually allowed
  $3,200 of a $4,000 claim and denied $800. A log that supports 60% of the trips
  supports 60% of the miles.
- **"Place" is not an enumerated element for listed property.** Reg.
  §1.274-5T(b)(6) lists exactly three: amount, time (date), business purpose.
  Place attaches to *travel* and *gifts*. Destination still matters as evidence,
  but the address chain is not the statutory requirement it was made out to be.

### ⚠️ UNRESOLVED AND IT COULD VOID THE WHOLE MILEAGE PLAN

**Was the standard mileage rate ever available on this van?** Pub 463: "If you
want to use the standard mileage rate for a car you own, you must choose to use
it **in the first year** the car is available for use in your business." Rev.
Proc. 2019-46 §4.05(3) bars the rate for any vehicle on which he claimed §179,
bonus depreciation, or MACRS. Expensing a work van under §179 is the single most
common move a contractor makes. **Pull his 2024 and 2025 returns, Schedule C
line 9 and Form 4562, before trusting any number this tool produces.**

Also worth two minutes: §274(d)'s last sentence exempts a "qualified nonpersonal
use vehicle," and Reg. §1.274-5(k)(2)(ii)(H) lists "Delivery trucks with seating
only for the driver, or only for the driver plus a folding jump seat." Almost
certainly unavailable (he drives it personally), but a yes removes the hardest
part of the problem.

### ✅ Estimated tax — much smaller than feared, with one precondition

- Next payment **September 15, 2026**. The four dates: Apr 15, Jun 15, Sep 15,
  Jan 15 2027.
- §6654(d)(1)(B): the required annual payment is the **LESSER** of 90% of 2026
  tax or **100% of the tax shown on his 2025 return**. The 110% bump in
  §6654(d)(1)(C) applies only above $150,000 of prior-year AGI — not him.
- **PRECONDITION, easily missed.** §6654(d)(1)(B) final sentence: "Clause (ii)
  shall not apply if the preceding taxable year was not a taxable year of 12
  months or **if the individual did not file a return for such preceding taxable
  year**." **Ask whether he filed 2025 before relying on any of this.**
- §6654(e)(2): if 2025 total tax was exactly $0, **no penalty at all** for 2026.
- §6654(e)(1): no penalty if 2026 tax is under $1,000.
- The penalty is **simple interest, not a fine** — §6622(b) exempts §6654 from
  daily compounding. 2026 rates: 7% Q1, 6% Q2, 7% Q3.
- **Scale: roughly $130–$220 if the prior-year safe harbor applies**, ~$440 if it
  does not. It is not the emergency. **The emergency is owing ~$4,100 in April
  with nothing in the account.** Sell him the cash-flow problem, not the penalty.
- §6654(b)(3) applies payments **oldest-installment-first**, so paying in
  September does not cure the April and June misses — it caps them.

### iPhone capture — corrections to the obvious advice

- Shortcut: **Take Photo** (Show Camera Preview ON) → **Save to Photo Album** →
  **Send Email** with "Show Compose Sheet" OFF. The silent-send behaviour of that
  toggle is **not documented by Apple** — widely relied on, but test it once.
- **Back Tap is a SINGLE-finger double tap** on an unlocked phone (iPhone 8+,
  iOS 14+). Two fingers does nothing. Action button is iPhone 15 Pro or later.
- **Gmail does NOT suppress mail you send to your own primary address** — that
  rule is about aliases and Groups. All Mail is still the right folder, for a
  better reason: it is a superset, immune to whether Gmail labelled it INBOX or
  SENT. The existing code already selects it.
- Do **not** filter on `has:attachment` — iOS Mail can inline a photo, and the
  receipt then becomes invisible with no error.
- `Save to Photo Album` is the cheap insurance: if the send fails in a dead zone
  the photo still exists on the phone.

## 5a. The receipt system — BUILT 2026-08-09

Working end to end on the PC side. `fetch-invoices.bat` now pulls invoices and
receipt photos in the same login, so it stays one double-click.

    phone   -> photo mailed to himself, subject RCPT
    PC      -> fetch_invoices.py drops it in data/inbox/, indexes data/receipts.json
    Claude  -> reads the image, runs `python receipts.py record <id> ...`
    receipts.py -> validates; clean ones go "ready", doubtful ones "needs a look"
    him     -> `python receipts.py ok --all`, and it lands in the tax ledger

- Dedup is on the **image bytes** (sha256), so mailing the same photo twice on a
  bad signal costs nothing.
- **HEIC is accepted, saved, and flagged** rather than dropped — iPhone's default
  format cannot be read here. The Shortcut needs a Convert Image step. A receipt
  that vanishes silently is the one failure that would kill the habit.
- Validators are arithmetic only, never a model's self-reported confidence:
  items+tax must equal the total to the cent, the date must parse and be in the
  past, and merchant+date+total collides against everything already filed.
- Categories come from `receipt-rules.txt`, a plain text file he can edit.
- The image is written once and never edited or deleted; every ledger entry
  points back at it by filename. Rev. Proc. 97-22 needs the image to survive.

Still to do: the iPhone-side Shortcut, and the dashboard review queue.

## 5b. The mileage log — BUILT 2026-08-09, and it is the bigger money

Receipts were what he asked for. **Mileage is worth several times more** and he
was claiming none of it. Same pipe, second keyword:

    phone -> odometer number mailed to himself, subject MILES, twice a day
    PC    -> fetch_invoices.py stores the readings in the ledger
    tax.py -> pairs each day's first and last reading into one business trip

The design rests on Pub 463's delivery-route example (quoted in 4b): distance +
date + business purpose is enough, and **the invoices already supply date and
purpose**. `workdays_from_invoices()` turns every invoice into
`{date: [job numbers]}`, so a trip's purpose reads "7 cable job(s), ticket(s)
144158, 144203…" — generated from a document Koscom issued, not from memory.

Rules that must not be relaxed:

- **First and last reading of the same day**, never one day's reading minus the
  next day's. The latter would sweep in every evening errand and overstate
  business miles, which is the one direction this must never err.
- A day with readings but **no invoice showing work** is excluded from the total,
  not guessed at — unless it is later than the newest invoice, since invoices
  arrive ~2.5 weeks in arrears.
- Reversed, identical, or absurd (>500 mi) readings are flagged, never averaged.
- Days he demonstrably worked and sent nothing are **counted and priced**, so the
  cost of skipping is visible rather than silent.
- Idempotent: rebuilding replaces only `source: odometer` trips and leaves
  hand-entered ones alone.

`python tax.py odometer 84213` records one by hand; the fetcher does it
automatically for anything mailed in.

## 5. The receipt system — the design that was chosen

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

## 6. Answered 2026-08-09

1. **iPhone.**
2. **1099-NEC, confirmed by him.** No W-2 component on the Koscom work, so the
   whole deduction side is live.
3. **Home office: yes, but the good version starts soon.** Right now he rents a
   room in a shared house — usable but the weak version of the exclusive-use
   test. **He moves to his own apartment in roughly 4–6 weeks from 2026-08-09 and
   will have a work-only spot there.** Treat the home office as starting at
   move-in. Get the exact date and the square footage the day he moves, and make
   him photograph the space.
4. **Nothing set aside. Zero.**
5. **~8 miles between job sites** (he says 7–10), and **home → first job is
   sometimes 20+** (North Port to Sarasota), sometimes local. Combined with the
   invoices — 4.43 days/week, 5.9 jobs/day — that is roughly **280 business miles
   a week**.

### Answered again 2026-08-09, later — three of these overturn earlier work

- **THE VAN IS KOSCOM'S, NOT HIS.** He drives a company vehicle. **There is no
  vehicle deduction for 2026 to date** — the whole mileage estimate above is for
  a van he does not yet own. He expects to buy his own **within about a month**,
  and the odometer system in 5b is built and waiting for it. Do not present
  mileage as a current deduction. Ask whether he owns a personal car in the
  meantime; if he drove one for the real-estate work he has miles for that.
- **The desk is NOT exclusive** — he uses it personally. So **no home office for
  2026 to date either**, and the Rev. Rul. 99-7 conversion does not apply yet.
  He answered honestly against his own interest, which is the right answer; a
  guessed "yes" is how people lose the whole deduction. Both the home office and
  the mileage start together when he moves and buys a vehicle.
- **He IS a licensed real estate agent** — joined Keller Williams on the Water
  2025-12-12, Stellar MLS 2026-01-16, and has just parked his license. He was
  operating, so the fees are deductible business expenses:

  | Source | Amount |
  |---|---|
  | Keller Williams monthly agent invoices, Jan–Jun 2026 (7) | $797.50 |
  | Stellar MLS, Jan / Feb / May 2026 | $1,264.75 |
  | **Documented total** | **$2,062.25** |

  Read straight out of the invoice PDFs in his Gmail. Worth **$444.70** of
  actual tax. Possibly more — RASM dues appear in a welcome email ($801, $150,
  $204, $40, $206) and were not separately confirmed. **He still needs to prove
  he PAID them** (cash basis) — bank or card statements.
- **He filed a 2025 return.** TaxSlayer, three rejections then
  **"Your federal tax return was accepted!" on 2026-04-13**. So the
  §6654(d)(1)(B) prior-year safe harbor **is** available. **Get Form 1040 line 24
  from his TaxSlayer account** — that number is his whole penalty-proof
  obligation for 2026.

### Current, corrected 2026 estimate

Koscom projected $31,004.84 · real-estate fees −$2,062.25 · no vehicle, no home
office → **owe about $4,953**, i.e. **$177/week**. Once he owns a van and has a
work-only room, a logged year saves about **$2,550**.

### Note for whoever parses more PDFs

`pdf_text.extract_rows` returns text with **NUL bytes between characters and
`\xa0` as the separator** on the Keller Williams and Stellar MLS PDFs (a
different font encoding to Koscom's). Clean with
`s.replace("\x00","").replace("\xa0"," ")` before regexing, or every match fails
silently.

### What the mailbox turned up that nobody had written down

- **He only started with Koscom the week of 2026-05-31.** First payout 2026-06-25.
  There are no earlier Koscom invoices in Gmail since 01-Jan-2026, so **2026 is a
  part-year 1099**: ~$31,000 projected, not the ~$57,600 full-year run rate.
  **He was almost certainly a W-2 employee at Koscom Jan–May 2026** (see section
  0). That means 2026 has BOTH W-2 wages and 1099 income. Two consequences: the
  wage income stacks on top and shifts the bracket, and — more usefully —
  **tax withheld from those wages counts toward the §6654 safe harbour**, and
  §6654(g) treats it as paid evenly across the whole year no matter when it came
  out. At his 2025 rate (~$2,039/month of wages, 6.9% withheld) four to five
  months of 2026 wages would be ~$566–708 of withholding, leaving only **$165–307**
  of the $873 still to pay. **Get his final Koscom pay stub or 2026 W-2 before he
  pays anything.**
- **He appears to have a second business.** Monthly *Keller Williams Realty*
  agent invoices and *Stellar MLS* annual billing run through his inbox from
  January onward. If he is licensed in real estate, those fees are deductible and
  none of them are recorded. Ask before assuming.
- **SunPass toll invoices.** Tolls and parking are deductible **on top of**
  standard mileage — the rate does not include them. `tax.py` now has a `tolls`
  category flagged `vehicle: False` for exactly this reason; do not "fix" it to
  True.
- **The van repair reimbursement never arrived.** The `TRUCK` adjustment is
  **$0.00 on all seven invoices**, including the two issued after Ashley approved
  it on 2026-07-24. Still owed.

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
