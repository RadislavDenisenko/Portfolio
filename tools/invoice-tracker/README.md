# Invoice tracker

Reads the weekly Koscom invoice PDF and answers the only questions worth asking
of it: how many jobs a day, how much a day, how many days, and how many jobs a
day it would take to hit a number.

Your pay data never leaves your machine. `data/` and `secrets.json` are
gitignored — this repository is public, so keep it that way.

## How the invoice reads

One row per pay line, and **several rows can share one JOB number**. Those are
separate things billed against the same visit, so they count as one job. A job
is a distinct JOB number on a given day, which is what these tools count.

`TOTAL JOBS` on the invoice is a dollar amount, not a count. `SOFT FEE` comes
off the top once a week.

## Use it

```bash
cd tools/invoice-tracker
python3 -m http.server 8080
# open http://localhost:8080/
```

Drop invoice PDFs onto the page. They are parsed in the browser and remembered
there, so the next time you open it everything is still there. Opening
`index.html` straight off disk works too — the local server is only needed for
the shared `data/invoices.json` the fetcher writes.

The command line does the same job:

```bash
python3 invoice_parser.py ~/Downloads/I0F8.pdf
python3 invoice_parser.py --store data/invoices.json ~/Downloads/*.pdf
```

## Fetch every Thursday

The invoices arrive Thursday and pay lands Friday. `fetch_invoices.py` logs into
Gmail over IMAP, finds the invoice emails, parses every PDF attachment it can,
and updates `data/invoices.json`.

It needs a Gmail **App Password** (not your account password) from
<https://myaccount.google.com/apppasswords>, which requires 2-step verification.
Put it in `secrets.json` next to the script:

```json
{"user": "raddenisenko@gmail.com", "password": "abcd efgh ijkl mnop"}
```

Then:

```bash
python3 fetch_invoices.py              # everything since 01-Jan-2026
python3 fetch_invoices.py --keep-pdfs  # also archive the PDFs into data/pdf/
```

Run it automatically on Thursday mornings:

```bash
# macOS / Linux — crontab -e
30 8 * * 4 cd ~/Portfolio/tools/invoice-tracker && /usr/bin/python3 fetch_invoices.py >> data/fetch.log 2>&1
```

On Windows, Task Scheduler → Create Basic Task → Weekly, Thursday → Start a
program → `python` with arguments `fetch_invoices.py` and "Start in" set to this
folder.

## Check it still works

```bash
python3 test_parser.py                 # the money math
python3 test_parser.py some-invoice.pdf  # and the PDF end to end
```

## Files

| File | Does |
|---|---|
| `index.html`, `assets/` | the dashboard |
| `assets/pdf-extract.js` | PDF text extraction in the browser, no library |
| `pdf_text.py` | the same algorithm in Python, stdlib only |
| `invoice_parser.py` | invoice semantics, the arithmetic, and a CLI report |
| `fetch_invoices.py` | Thursday Gmail fetch |
| `test_parser.py` | the check |

No dependencies anywhere — Python standard library, and plain browser APIs.
`pdf_text.py` and `assets/pdf-extract.js` are ports of each other; change one,
change the other.
