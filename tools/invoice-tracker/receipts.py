"""Turn a photographed receipt into a ledger entry, with the checking done by
arithmetic rather than by asking a model how sure it is.

The flow, and where each step happens:

    phone   -> photo mailed to himself, subject RCPT
    PC      -> fetch_invoices.py drops it in data/inbox/ and indexes it
    Claude  -> reads the image, calls `record` with what it saw
    here    -> validates; clean ones land in the ledger, doubtful ones queue up
    him     -> glances at the queue, says yes

The validation deliberately never asks the model for a confidence score. Models
report high confidence whether or not they are right, so a score would only
launder a guess into a number. What is checked instead is checkable: do the line
items plus tax equal the printed total to the cent, does the date parse and sit
in the past, and have we seen this merchant/date/total before. Those catch the
failure that actually happens — a digit misread off crumpled thermal paper.

The image is never deleted and never edited. Rev. Proc. 97-22 only lets a scan
replace the paper if the image itself survives and can be produced on demand;
keeping the extracted numbers alone would throw away the record.

    python receipts.py pending          # what still needs reading
    python receipts.py record ab12cd34 --merchant "Home Depot" --date 2026-08-09 \
        --total 47.32 --tax 3.02 --items 22.15,22.15 --category tools
    python receipts.py queue            # what needs his eyes
    python receipts.py ok ab12cd34      # he confirms; it enters the ledger
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

import fetch_invoices
import tax

HERE = Path(__file__).parent
RULES = HERE / "receipt-rules.txt"

# Merchant -> Schedule C category. A plain text file he can open and edit beats
# asking a model to categorise every purchase: it is deterministic, it is
# debuggable, and when it gets something wrong he can fix it himself in Notepad.
DEFAULT_RULES = """\
# Which category a receipt lands in, decided by what the merchant is called.
# One rule per line:   text to look for = category
# First match wins. Case does not matter. Lines starting with # are ignored.
#
# Categories: gas repairs tolls insurance office supplies tools licenses
#             travel meals phone other
#
# Edit this file freely — it is read fresh every time.

home depot      = tools
lowes           = tools
harbor freight  = tools
ace hardware    = tools
klein           = tools
milwaukee       = tools

autozone        = repairs
o'reilly        = repairs
oreilly         = repairs
advance auto    = repairs
napa            = repairs
discount tire   = repairs
valvoline       = repairs
jiffy lube      = repairs

wawa            = gas
racetrac        = gas
7-eleven        = gas
circle k        = gas
shell           = gas
chevron         = gas
mobil           = gas
exxon           = gas
marathon        = gas
bp              = gas
sunoco          = gas
speedway        = gas
buc-ee          = gas

sunpass         = tolls
toll            = tolls
parking         = tolls

verizon         = phone
t-mobile        = phone
at&t            = phone
cricket         = phone

staples         = office
office depot    = office
usps            = office
ups store       = office
fedex           = office

stellar mls     = licenses
keller williams = licenses
realtor         = licenses
dbpr            = licenses
state of florida = licenses

amazon          = supplies
walmart         = supplies
target          = supplies
"""


def load_rules() -> list[tuple[str, str]]:
    if not RULES.exists():
        RULES.write_text(DEFAULT_RULES, "utf-8")
    rules = []
    for line in RULES.read_text("utf-8").splitlines():
        line = line.split("#")[0].strip()
        if "=" not in line:
            continue
        pattern, category = line.split("=", 1)
        pattern, category = pattern.strip().lower(), category.strip().lower()
        if pattern and category in tax.CATEGORIES:
            rules.append((pattern, category))
    return rules


def categorise(merchant: str) -> str:
    haystack = merchant.lower()
    for pattern, category in load_rules():
        if pattern in haystack:
            return category
    return "other"


def find(index: dict, receipt_id: str) -> dict | None:
    """Match on a prefix, so he never has to type twelve hex characters."""
    hits = [r for r in index["receipts"] if r["id"].startswith(receipt_id.lower())]
    return hits[0] if len(hits) == 1 else None


def validate(index: dict, receipt: dict, extracted: dict) -> list[str]:
    """Every check here is arithmetic or a lookup. None of it is a judgement."""
    problems = []

    total = extracted["total_cents"]
    items = extracted.get("item_cents") or []
    item_tax = extracted.get("tax_cents") or 0

    if total <= 0:
        problems.append("Total is zero or negative — that is a misread.")

    # The one check that actually catches a misread digit.
    if items:
        summed = sum(items) + item_tax
        if summed != total:
            problems.append(
                f"Line items plus tax come to {tax.money(summed)} but the receipt "
                f"says {tax.money(total)} — off by {tax.money(abs(summed - total))}."
            )

    if item_tax > total:
        problems.append("Tax is larger than the total.")

    date = extracted.get("date") or ""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        problems.append(f"Date {date!r} is not a real date.")
    else:
        try:
            when = dt.date.fromisoformat(date)
        except ValueError:
            problems.append(f"Date {date!r} is not a real date.")
        else:
            if when > dt.date.today():
                problems.append(f"Date {date} is in the future.")
            if when.year < 2020:
                problems.append(f"Date {date} looks far too old — check the year.")

    if not (extracted.get("merchant") or "").strip():
        problems.append("No merchant name.")

    # Same shop, same day, same amount, different photo: almost always the same
    # receipt mailed twice, occasionally two genuine trips. Flag, never drop.
    for other in index["receipts"]:
        if other["id"] == receipt["id"] or not other.get("extracted"):
            continue
        prior = other["extracted"]
        if (
            prior.get("merchant", "").lower() == extracted.get("merchant", "").lower()
            and prior.get("date") == extracted.get("date")
            and prior.get("total_cents") == total
        ):
            problems.append(
                f"Looks like a duplicate of receipt {other['id']} ({other['file']}) — "
                "same shop, same day, same amount."
            )

    if extracted.get("category") == "meals":
        problems.append(
            "Meals: only deductible if the trip kept you away overnight. Lunch "
            "between job sites is personal, however work-related it felt."
        )

    return problems


def cmd_pending(index: dict) -> int:
    waiting = [r for r in index["receipts"] if r["status"] == "needs extraction"]
    if not waiting:
        print("Nothing waiting. Every receipt has been read.")
        return 0
    print(f"{len(waiting)} receipt(s) to read:\n")
    for r in waiting:
        path = fetch_invoices.INBOX / r["file"]
        print(f"  {r['id']}  {r['received']}  {path}")
        for problem in r.get("problems", []):
            print(f"      ! {problem}")
    print(
        "\nClaude: read each image, then for each one run\n"
        "  python receipts.py record <id> --merchant .. --date YYYY-MM-DD "
        "--total .. [--tax ..] [--items a,b,c]"
    )
    return 0


def cmd_record(index: dict, args) -> int:
    receipt = find(index, args.id)
    if not receipt:
        print(f"No single receipt matching {args.id!r}.", file=sys.stderr)
        return 1

    extracted = {
        "merchant": args.merchant.strip(),
        "date": args.date,
        "total_cents": tax.to_cents(args.total),
        "tax_cents": tax.to_cents(args.tax) if args.tax else 0,
        "item_cents": [tax.to_cents(x) for x in args.items.split(",") if x.strip()]
        if args.items else [],
        "category": args.category or categorise(args.merchant),
        "note": args.note,
    }

    problems = validate(index, receipt, extracted)
    receipt["extracted"] = extracted
    receipt["problems"] = problems
    receipt["status"] = "needs a look" if problems else "ready"
    fetch_invoices.save_receipts(index)

    print(
        f"{receipt['id']}  {extracted['merchant']}  {extracted['date']}  "
        f"{tax.money(extracted['total_cents'])}  [{extracted['category']}]"
    )
    if problems:
        for problem in problems:
            print(f"  ! {problem}")
        print("  -> queued for him to look at.")
    else:
        print("  arithmetic checks out -> ready to file.")
    return 0


def cmd_queue(index: dict) -> int:
    flagged = [r for r in index["receipts"] if r["status"] == "needs a look"]
    ready = [r for r in index["receipts"] if r["status"] == "ready"]

    if ready:
        total = sum(r["extracted"]["total_cents"] for r in ready)
        print(f"{len(ready)} receipt(s) checked out and ready to file — {tax.money(total)}")
        for r in ready:
            e = r["extracted"]
            print(f"  {r['id']}  {e['date']}  {e['merchant']:<24} "
                  f"{tax.money(e['total_cents']):>10}  {e['category']}")
        print("\n  File them all:  python receipts.py ok --all")

    if flagged:
        print(f"\n{len(flagged)} need your eyes:\n")
        for r in flagged:
            e = r.get("extracted") or {}
            print(f"  {r['id']}  {e.get('merchant','?')}  {tax.money(e.get('total_cents',0))}")
            print(f"      {fetch_invoices.INBOX / r['file']}")
            for problem in r["problems"]:
                print(f"      ! {problem}")

    if not ready and not flagged:
        print("Queue is empty.")
    return 0


def cmd_ok(index: dict, args) -> int:
    if args.all:
        chosen = [r for r in index["receipts"] if r["status"] == "ready"]
    else:
        one = find(index, args.id or "")
        if not one:
            print(f"No single receipt matching {args.id!r}.", file=sys.stderr)
            return 1
        chosen = [one]

    chosen = [r for r in chosen if r.get("extracted")]
    if not chosen:
        print("Nothing to file.")
        return 0

    ledger = tax.load()
    filed = 0
    for r in chosen:
        e = r["extracted"]
        tax.add_expense(
            ledger,
            e["total_cents"],
            e["merchant"],
            e["category"],
            e["date"],
            e.get("note", ""),
            source=r["file"],          # the image stays the record
            confidence="scanned",
        )
        r["status"] = "filed"
        filed += 1
    tax.save(ledger)
    fetch_invoices.save_receipts(index)
    print(f"Filed {filed} receipt(s). The photos stay in {fetch_invoices.INBOX}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="command", required=True)

    sub.add_parser("pending", help="receipts waiting to be read")
    sub.add_parser("queue", help="what is ready and what needs a look")

    rec = sub.add_parser("record", help="save what was read off one image")
    rec.add_argument("id")
    rec.add_argument("--merchant", required=True)
    rec.add_argument("--date", required=True, help="YYYY-MM-DD, off the receipt")
    rec.add_argument("--total", required=True)
    rec.add_argument("--tax", default="")
    rec.add_argument("--items", default="", help="comma separated line amounts")
    rec.add_argument("--category", default="", choices=[""] + sorted(tax.CATEGORIES))
    rec.add_argument("--note", default="")

    okp = sub.add_parser("ok", help="confirm and file into the ledger")
    okp.add_argument("id", nargs="?")
    okp.add_argument("--all", action="store_true")

    args = ap.parse_args(argv)
    index = fetch_invoices.load_receipts()

    if args.command == "pending":
        return cmd_pending(index)
    if args.command == "record":
        return cmd_record(index, args)
    if args.command == "queue":
        return cmd_queue(index)
    return cmd_ok(index, args)


if __name__ == "__main__":
    raise SystemExit(main())
