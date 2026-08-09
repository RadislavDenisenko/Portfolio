"""Turn a Koscom FL invoice PDF into structured pay data, and do the math on it.

The invoice is a flat list of pay lines. Several lines can share one JOB number:
those are separate things billed against the same visit, not separate jobs. So a
"job" here means a distinct JOB number on a given day, which is what you count
when you ask "how many jobs did I do today".

Money is handled in whole cents everywhere. Dollars only appear at the edges,
because summing 61 floats and comparing against a printed total is exactly the
place where a tenth of a cent turns into a wrong answer.

Run it directly for a report:

    python3 invoice_parser.py ~/Downloads/I0F8.pdf
    python3 invoice_parser.py --json invoices/*.pdf
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

import pdf_text

MONTHS = {
    m.lower(): i
    for i, m in enumerate(
        "January February March April May June July August September "
        "October November December".split(),
        start=1,
    )
}

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONEY_RE = re.compile(r"^-?\$-?[\d,]+\.\d{2}$|^\(\$[\d,]+\.\d{2}\)$")


def money_to_cents(text: str) -> int:
    """``-$6.25`` and ``($6.25)`` both mean minus 625 cents."""
    text = text.strip()
    negative = text.startswith("-") or "$-" in text or text.startswith("(")
    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return 0
    return -int(digits) if negative else int(digits)


def cents_to_str(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents) // 100:,}.{abs(cents) % 100:02d}"


def _parse_period(text: str) -> tuple[str | None, str | None]:
    """Parse the PAY PERIOD cell into ISO start and end dates.

    Handles ``July 05-11, 2026``, ``June 28-July 04, 2026`` and
    ``December 28, 2025-January 03, 2026``.
    """
    text = text.replace("–", "-").replace("—", "-").strip()

    m = re.fullmatch(r"([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})", text)
    if m and m.group(1).lower() in MONTHS:
        month, year = MONTHS[m.group(1).lower()], int(m.group(4))
        return (
            dt.date(year, month, int(m.group(2))).isoformat(),
            dt.date(year, month, int(m.group(3))).isoformat(),
        )

    m = re.fullmatch(
        r"([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", text
    )
    if m and m.group(1).lower() in MONTHS and m.group(3).lower() in MONTHS:
        m1, m2, year = MONTHS[m.group(1).lower()], MONTHS[m.group(3).lower()], int(m.group(5))
        start_year = year - 1 if m1 > m2 else year
        return (
            dt.date(start_year, m1, int(m.group(2))).isoformat(),
            dt.date(year, m2, int(m.group(4))).isoformat(),
        )

    m = re.fullmatch(
        r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", text
    )
    if m and m.group(1).lower() in MONTHS and m.group(4).lower() in MONTHS:
        return (
            dt.date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat(),
            dt.date(int(m.group(6)), MONTHS[m.group(4).lower()], int(m.group(5))).isoformat(),
        )

    return None, None


def parse(pdf_bytes: bytes, source: str | None = None) -> dict:
    """Extract the invoice into a plain dict."""
    return parse_rows(pdf_text.extract_rows(pdf_bytes), source)


def parse_rows(rows: list[list[str]], source: str | None = None) -> dict:
    """The invoice semantics, split out from the PDF so it can be tested alone."""
    line_items: list[dict] = []
    adjustments: list[dict] = []
    printed: dict[str, int] = {}
    tech_id = name = pay_period = ""

    for i, row in enumerate(rows):
        # Header: the values sit on the row below the TECH # / NAME / PAY PERIOD labels.
        joined = " ".join(row).upper()
        if "TECH" in joined and "PAY PERIOD" in joined and i + 1 < len(rows):
            values = rows[i + 1]
            if len(values) >= 3:
                tech_id, name, pay_period = values[0], values[1], values[2]
            continue

        if len(row) == 4 and DATE_RE.match(row[0]) and MONEY_RE.match(row[3]):
            line_items.append(
                {
                    "date": row[0],
                    "code": row[1],
                    "job": row[2],
                    "cents": money_to_cents(row[3]),
                }
            )
            continue

        # Any other row ending in money is a summary or an adjustment.
        if len(row) >= 2 and MONEY_RE.match(row[-1]):
            label = " ".join(row[:-1]).strip()
            cents = money_to_cents(row[-1])
            key = label.upper()
            if key in ("TOTAL JOBS", "TOTAL PAY", "SUBTOTAL", "TOTAL"):
                printed[key] = cents
            else:
                adjustments.append({"label": label, "cents": cents})

    start, end = _parse_period(pay_period)
    dates = sorted({item["date"] for item in line_items})
    if not start and dates:
        # Fall back to the Sunday-Saturday week the work actually landed in.
        last = dt.date.fromisoformat(dates[-1])
        end_date = last + dt.timedelta(days=(5 - last.weekday()) % 7)
        start, end = (end_date - dt.timedelta(days=6)).isoformat(), end_date.isoformat()

    return {
        "tech_id": tech_id,
        "name": name,
        "pay_period": pay_period,
        "period_start": start,
        "period_end": end,
        "source": source or "",
        "line_items": line_items,
        "adjustments": adjustments,
        "printed": printed,
    }


def analyze(invoice: dict) -> dict:
    """Roll an invoice up into per-day and per-week numbers."""
    by_date: dict[str, dict] = {}
    for item in invoice["line_items"]:
        day = by_date.setdefault(
            item["date"], {"date": item["date"], "jobs": {}, "lines": 0, "cents": 0}
        )
        day["jobs"].setdefault(item["job"], 0)
        day["jobs"][item["job"]] += item["cents"]
        day["lines"] += 1
        day["cents"] += item["cents"]

    days = []
    for date in sorted(by_date):
        day = by_date[date]
        job_count = len(day["jobs"])
        days.append(
            {
                "date": date,
                "weekday": dt.date.fromisoformat(date).strftime("%a"),
                "jobs": job_count,
                "lines": day["lines"],
                "cents": day["cents"],
                "cents_per_job": round(day["cents"] / job_count) if job_count else 0,
                "job_numbers": sorted(day["jobs"]),
            }
        )

    gross = sum(d["cents"] for d in days)
    jobs = sum(d["jobs"] for d in days)
    adjust = sum(a["cents"] for a in invoice["adjustments"])
    worked = len(days)

    printed_gross = invoice["printed"].get("TOTAL JOBS")
    printed_net = invoice["printed"].get("TOTAL PAY")

    return {
        "days": days,
        "days_worked": worked,
        "jobs": jobs,
        "lines": sum(d["lines"] for d in days),
        "gross_cents": gross,
        "adjustments_cents": adjust,
        "net_cents": gross + adjust,
        "printed_gross_cents": printed_gross,
        "printed_net_cents": printed_net,
        # A non-zero value means the invoice's own total disagrees with its lines.
        "gross_discrepancy_cents": (
            gross - printed_gross if printed_gross is not None else 0
        ),
        "cents_per_job": round(gross / jobs) if jobs else 0,
        "jobs_per_day": round(jobs / worked, 2) if worked else 0.0,
        "cents_per_day": round(gross / worked) if worked else 0,
    }


def jobs_needed(target_cents: int, days: int, cents_per_job: int, fees_cents: int = 0) -> dict:
    """How many jobs a day it takes to clear ``target_cents`` net in a week.

    ``fees_cents`` is the weekly deduction (negative), so it is subtracted from
    the target to get the gross that has to be billed.
    """
    if days <= 0 or cents_per_job <= 0:
        return {"jobs_per_day": 0.0, "jobs_per_week": 0.0, "cents_per_day": 0}
    gross_needed = target_cents - fees_cents
    per_week = gross_needed / cents_per_job
    return {
        "jobs_per_day": round(per_week / days, 2),
        "jobs_per_week": round(per_week, 2),
        "cents_per_day": round(gross_needed / days),
    }


# ------------------------------------------------------------- the store


def load_store(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text("utf-8"))
        except json.JSONDecodeError:
            pass
    return {"invoices": []}


def save_store(path: Path, store: dict) -> None:
    """Write the store back, newest week first."""
    store["invoices"].sort(key=lambda inv: inv.get("period_end") or "", reverse=True)
    store["updated"] = dt.datetime.now().isoformat(timespec="seconds")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(store, indent=2) + "\n", "utf-8")


def merge(store: dict, invoice: dict) -> bool:
    """Add or replace an invoice in the store. True if anything changed."""
    key = invoice.get("period_end")
    for i, existing in enumerate(store["invoices"]):
        if existing.get("period_end") == key:
            if existing == invoice:
                return False
            store["invoices"][i] = invoice
            return True
    store["invoices"].append(invoice)
    return True


# -------------------------------------------------------------- report


def report(invoice: dict) -> str:
    stats = analyze(invoice)
    out: list[str] = []
    period = invoice["pay_period"] or f"{invoice['period_start']} .. {invoice['period_end']}"
    out.append(f"  {invoice['name'] or 'tech'}  ({invoice['tech_id']})   {period}")
    out.append("")
    out.append("  DAY            JOBS   LINES        PAID     PER JOB")
    out.append("  " + "-" * 52)
    for day in stats["days"]:
        out.append(
            f"  {day['date']} {day['weekday']}  {day['jobs']:4d}  {day['lines']:6d}"
            f"  {cents_to_str(day['cents']):>10}  {cents_to_str(day['cents_per_job']):>10}"
        )
    out.append("  " + "-" * 52)
    out.append(
        f"  {stats['days_worked']} days worked   {stats['jobs']:4d}"
        f"  {stats['lines']:6d}  {cents_to_str(stats['gross_cents']):>10}"
        f"  {cents_to_str(stats['cents_per_job']):>10}"
    )
    out.append("")
    for adj in invoice["adjustments"]:
        out.append(f"  {adj['label']:<24}{cents_to_str(adj['cents']):>12}")
    out.append(f"  {'TAKE HOME (from lines)':<24}{cents_to_str(stats['net_cents']):>12}")
    if stats["printed_net_cents"] is not None:
        out.append(
            f"  {'TAKE HOME (invoice says)':<24}"
            f"{cents_to_str(stats['printed_net_cents']):>12}"
        )

    if stats["gross_discrepancy_cents"]:
        diff = stats["gross_discrepancy_cents"]
        out.append("")
        out.append(
            f"  ! The {stats['lines']} pay lines add up to "
            f"{cents_to_str(stats['gross_cents'])}, but the invoice prints "
            f"{cents_to_str(stats['printed_gross_cents'])} "
            f"({cents_to_str(abs(diff))} {'short' if diff > 0 else 'over'})."
        )

    out.append("")
    out.append(
        f"  Average: {stats['jobs_per_day']} jobs/day, "
        f"{cents_to_str(stats['cents_per_day'])}/day, "
        f"{cents_to_str(stats['cents_per_job'])}/job"
    )
    fees = stats["adjustments_cents"]
    for target in (120000, 130000, 150000):
        for days in (5, 6):
            need = jobs_needed(target, days, stats["cents_per_job"], fees)
            out.append(
                f"  To net {cents_to_str(target)} over {days} days: "
                f"{need['jobs_per_day']} jobs/day "
                f"({need['jobs_per_week']} jobs, {cents_to_str(need['cents_per_day'])}/day)"
            )
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("pdfs", nargs="+", type=Path, help="invoice PDF(s)")
    ap.add_argument("--json", action="store_true", help="print parsed JSON instead")
    ap.add_argument("--store", type=Path, help="merge results into this JSON store")
    args = ap.parse_args(argv)

    parsed = []
    for path in args.pdfs:
        try:
            invoice = parse(path.read_bytes(), source=path.name)
        except Exception as exc:  # a malformed PDF should name itself, not traceback
            print(f"{path}: could not parse ({exc})", file=sys.stderr)
            continue
        if not invoice["line_items"]:
            print(f"{path}: no pay lines found, skipping", file=sys.stderr)
            continue
        parsed.append(invoice)

    if not parsed:
        return 1

    if args.json:
        print(json.dumps(parsed if len(parsed) > 1 else parsed[0], indent=2))
    else:
        for invoice in parsed:
            print()
            print(report(invoice))
            print()

    if args.store:
        store = load_store(args.store)
        changed = sum(merge(store, inv) for inv in parsed)
        save_store(args.store, store)
        print(f"{changed} invoice(s) written to {args.store}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
