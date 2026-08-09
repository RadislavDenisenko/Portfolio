"""Expenses, mileage, and what they knock off the tax bill.

Radislav is a 1099 contractor: nothing is withheld from the Koscom invoices, so
every deductible dollar recorded here is a dollar he does not pay tax on, and
the money has to be set aside by him rather than by an employer.

The one rule this file exists to enforce: **you cannot claim standard mileage
and the van's running costs in the same year.** Standard mileage already covers
fuel, repairs, insurance and depreciation. Logging both is double-dipping, and
it is the single easiest way for an honest person to file a wrong return. Pick a
method per vehicle per year; everything downstream honours it.

Money in whole cents. Miles as floats.

    python3 tax.py add 45.99 AutoZone --category repairs --note "serpentine belt"
    python3 tax.py miles 142 --note "job sites"
    python3 tax.py report
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
LEDGER = HERE / "data" / "ledger.json"

# 2026 IRS standard mileage rate, cents per mile. VERIFY against irs.gov each
# January — it moves every year and a stale rate quietly misstates the return.
MILEAGE_RATE_CENTS = 70.0
MILEAGE_RATE_YEAR = 2026

# Schedule C (Form 1040) Part II lines, trimmed to what a field technician
# driving to job sites actually incurs. `vehicle` marks the ones that standard
# mileage already covers.
CATEGORIES = {
    "mileage":    {"line": "9",   "label": "Car and truck expenses", "vehicle": True},
    "gas":        {"line": "9",   "label": "Car and truck — fuel", "vehicle": True},
    "repairs":    {"line": "9",   "label": "Car and truck — repairs", "vehicle": True},
    "insurance":  {"line": "15",  "label": "Insurance (not health)", "vehicle": False},
    "office":     {"line": "18",  "label": "Office expense", "vehicle": False},
    "supplies":   {"line": "22",  "label": "Supplies", "vehicle": False},
    "tools":      {"line": "22",  "label": "Supplies — tools", "vehicle": False},
    "licenses":   {"line": "23",  "label": "Taxes and licenses", "vehicle": False},
    "travel":     {"line": "24a", "label": "Travel", "vehicle": False},
    "meals":      {"line": "24b", "label": "Meals (50% deductible)", "vehicle": False},
    "phone":      {"line": "25",  "label": "Utilities — phone", "vehicle": False},
    "other":      {"line": "27a", "label": "Other expenses", "vehicle": False},
}

# Meals are half deductible; everything else here is fully deductible.
DEDUCTIBLE_FRACTION = {"meals": 0.5}

SE_TAX_RATE = 0.153          # 12.4% Social Security + 2.9% Medicare
SE_TAXABLE_FRACTION = 0.9235  # SE tax applies to 92.35% of net earnings
SE_DEDUCTION = 0.5            # half of SE tax is an income-tax deduction

# 2026 federal brackets, single filer. Also worth re-checking each January.
STANDARD_DEDUCTION_CENTS = 1_550_000
BRACKETS = [
    (1_192_500, 0.10),
    (4_847_500, 0.12),
    (10_335_000, 0.22),
    (19_730_000, 0.24),
    (25_052_500, 0.32),
    (62_635_000, 0.35),
    (float("inf"), 0.37),
]


def load() -> dict:
    if LEDGER.exists():
        try:
            return json.loads(LEDGER.read_text("utf-8"))
        except json.JSONDecodeError:
            pass
    return {"expenses": [], "mileage": [], "vehicle_method": "standard"}


def save(ledger: dict) -> None:
    ledger["expenses"].sort(key=lambda e: e.get("date") or "")
    ledger["mileage"].sort(key=lambda m: m.get("date") or "")
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(json.dumps(ledger, indent=2) + "\n", "utf-8")


def money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents) // 100:,}.{abs(cents) % 100:02d}"


def to_cents(amount: str | float) -> int:
    """'45.99', '$45.99', 45.99 -> 4599."""
    if isinstance(amount, (int, float)):
        return round(float(amount) * 100)
    digits = re.sub(r"[^\d.]", "", str(amount))
    return round(float(digits) * 100) if digits else 0


def add_expense(
    ledger: dict,
    amount_cents: int,
    merchant: str,
    category: str = "other",
    date: str | None = None,
    note: str = "",
    source: str = "",
    confidence: str = "manual",
) -> dict:
    """Record one deductible purchase. `source` is the receipt image it came from."""
    if category not in CATEGORIES:
        category = "other"
    entry = {
        "id": f"{date or dt.date.today().isoformat()}-{len(ledger['expenses']) + 1:04d}",
        "date": date or dt.date.today().isoformat(),
        "merchant": merchant.strip(),
        "cents": amount_cents,
        "category": category,
        "note": note.strip(),
        "source": source,
        # Anything a machine read needs a human to confirm before it is filed.
        "confidence": confidence,
        "reviewed": confidence == "manual",
    }
    ledger["expenses"].append(entry)
    return entry


def add_miles(ledger: dict, miles: float, date: str | None = None, note: str = "") -> dict:
    """Record a day's business driving.

    Pub 463 wants date, mileage and business purpose, so `note` is the purpose
    and is worth filling in — an undated pile of numbers is not a log.
    """
    entry = {
        "date": date or dt.date.today().isoformat(),
        "miles": round(float(miles), 1),
        "note": note.strip() or "job sites",
    }
    ledger["mileage"].append(entry)
    return entry


def _year(value: str, year: int | None) -> bool:
    return year is None or value.startswith(str(year))


def summarize(ledger: dict, year: int | None = None) -> dict:
    """Totals by category, plus the mileage deduction, honouring the method."""
    method = ledger.get("vehicle_method", "standard")

    by_category: dict[str, dict] = {}
    for expense in ledger["expenses"]:
        if not _year(expense["date"], year):
            continue
        slot = by_category.setdefault(
            expense["category"], {"cents": 0, "count": 0, "deductible_cents": 0}
        )
        fraction = DEDUCTIBLE_FRACTION.get(expense["category"], 1.0)
        slot["cents"] += expense["cents"]
        slot["count"] += 1
        slot["deductible_cents"] += round(expense["cents"] * fraction)

    miles = sum(m["miles"] for m in ledger["mileage"] if _year(m["date"], year))
    mileage_cents = round(miles * MILEAGE_RATE_CENTS)

    # The whole point of this module.
    vehicle_cents = sum(
        slot["deductible_cents"]
        for name, slot in by_category.items()
        if CATEGORIES[name]["vehicle"]
    )
    if method == "standard":
        claimed_vehicle = mileage_cents
        excluded = vehicle_cents
    else:
        claimed_vehicle = vehicle_cents
        excluded = mileage_cents

    non_vehicle = sum(
        slot["deductible_cents"]
        for name, slot in by_category.items()
        if not CATEGORIES[name]["vehicle"]
    )

    return {
        "method": method,
        "by_category": by_category,
        "miles": round(miles, 1),
        "mileage_cents": mileage_cents,
        "vehicle_expense_cents": vehicle_cents,
        "claimed_vehicle_cents": claimed_vehicle,
        "excluded_cents": excluded,
        "non_vehicle_cents": non_vehicle,
        "total_deduction_cents": claimed_vehicle + non_vehicle,
        "unreviewed": sum(
            1 for e in ledger["expenses"] if not e.get("reviewed") and _year(e["date"], year)
        ),
    }


def estimate_tax(gross_cents: int, deduction_cents: int) -> dict:
    """Rough federal estimate for a single filer in Florida (no state income tax).

    An estimate for setting money aside, not a return. It ignores credits,
    dependants, QBI, and anything else a real preparer would apply.
    """
    net_profit = max(0, gross_cents - deduction_cents)
    se_base = round(net_profit * SE_TAXABLE_FRACTION)
    se_tax = round(se_base * SE_TAX_RATE)

    taxable = max(0, net_profit - round(se_tax * SE_DEDUCTION) - STANDARD_DEDUCTION_CENTS)
    income_tax = 0
    last = 0
    for ceiling, rate in BRACKETS:
        if taxable <= last:
            break
        income_tax += round((min(taxable, ceiling) - last) * rate)
        last = ceiling

    total = se_tax + income_tax
    return {
        "net_profit_cents": net_profit,
        "se_tax_cents": se_tax,
        "income_tax_cents": income_tax,
        "total_tax_cents": total,
        "effective_rate": total / net_profit if net_profit else 0.0,
        "quarterly_cents": round(total / 4),
    }


def report(ledger: dict, year: int | None = None, gross_cents: int = 0) -> str:
    stats = summarize(ledger, year)
    out: list[str] = []
    label = year or "all years"
    out.append(f"  DEDUCTIONS — {label}")
    out.append("  " + "-" * 52)

    for name, slot in sorted(
        stats["by_category"].items(), key=lambda kv: -kv[1]["deductible_cents"]
    ):
        info = CATEGORIES[name]
        excluded = info["vehicle"] and stats["method"] == "standard"
        tag = "  (covered by mileage)" if excluded else ""
        out.append(
            f"  {info['label']:<34}{money(slot['deductible_cents']):>10}"
            f"  x{slot['count']}{tag}"
        )

    out.append("")
    out.append(
        f"  {stats['miles']:,.1f} business miles at {MILEAGE_RATE_CENTS:.0f}c"
        f"  ->{money(stats['mileage_cents']):>13}"
    )
    if stats["method"] == "standard" and stats["vehicle_expense_cents"]:
        out.append(
            f"  Van costs of {money(stats['vehicle_expense_cents'])} are NOT claimed "
            "separately —\n  standard mileage already covers fuel, repairs and "
            "depreciation."
        )
    out.append("  " + "-" * 52)
    out.append(f"  {'TOTAL DEDUCTION':<34}{money(stats['total_deduction_cents']):>10}")

    # Whichever method is worth more is the one to claim. Say so rather than
    # letting the default quietly cost him money.
    gap = stats["excluded_cents"] - stats["claimed_vehicle_cents"]
    if gap > 0:
        other = "actual van costs" if stats["method"] == "standard" else "standard mileage"
        out.append("")
        out.append(
            f"  ! Claiming {other} instead would be worth {money(gap)} more this year.\n"
            f"    Switch with:  python3 tax.py method "
            f"{'actual' if stats['method'] == 'standard' else 'standard'}\n"
            "    Check with a preparer first — the first year you use a vehicle\n"
            "    can lock you out of switching later."
        )

    if stats["unreviewed"]:
        out.append("")
        out.append(f"  ! {stats['unreviewed']} scanned item(s) still need a quick look.")

    if gross_cents:
        tax = estimate_tax(gross_cents, stats["total_deduction_cents"])
        out.append("")
        out.append(f"  TAX ESTIMATE on {money(gross_cents)} of invoices")
        out.append("  " + "-" * 52)
        out.append(f"  {'Net profit after deductions':<34}{money(tax['net_profit_cents']):>10}")
        out.append(f"  {'Self-employment tax':<34}{money(tax['se_tax_cents']):>10}")
        out.append(f"  {'Federal income tax':<34}{money(tax['income_tax_cents']):>10}")
        out.append(f"  {'TOTAL to set aside':<34}{money(tax['total_tax_cents']):>10}")
        out.append(
            f"  {'Effective rate':<34}{tax['effective_rate'] * 100:>9.1f}%"
        )
        out.append(f"  {'Per quarter':<34}{money(tax['quarterly_cents']):>10}")
        saved = round(stats["total_deduction_cents"] * tax["effective_rate"])
        out.append("")
        out.append(f"  Those deductions saved you about {money(saved)}.")

    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="command", required=True)

    a = sub.add_parser("add", help="record an expense")
    a.add_argument("amount")
    a.add_argument("merchant")
    a.add_argument("--category", default="other", choices=sorted(CATEGORIES))
    a.add_argument("--date")
    a.add_argument("--note", default="")
    a.add_argument("--source", default="")

    m = sub.add_parser("miles", help="record a day's driving")
    m.add_argument("miles", type=float)
    m.add_argument("--date")
    m.add_argument("--note", default="")

    r = sub.add_parser("report", help="deductions and tax estimate")
    r.add_argument("--year", type=int, default=dt.date.today().year)
    r.add_argument("--gross", help="invoice income, e.g. 57000")

    v = sub.add_parser("method", help="standard mileage or actual vehicle costs")
    v.add_argument("choice", choices=["standard", "actual"])

    args = ap.parse_args(argv)
    ledger = load()

    if args.command == "add":
        entry = add_expense(
            ledger, to_cents(args.amount), args.merchant,
            args.category, args.date, args.note, args.source,
        )
        save(ledger)
        print(f"Recorded {money(entry['cents'])} at {entry['merchant']} ({entry['category']})")
    elif args.command == "miles":
        entry = add_miles(ledger, args.miles, args.date, args.note)
        save(ledger)
        print(
            f"Recorded {entry['miles']} miles on {entry['date']} "
            f"= {money(round(entry['miles'] * MILEAGE_RATE_CENTS))} off your taxable income"
        )
    elif args.command == "method":
        ledger["vehicle_method"] = args.choice
        save(ledger)
        print(f"Vehicle method set to {args.choice}.")
    else:
        gross = to_cents(args.gross) if args.gross else 0
        if not gross:
            # Fall back to whatever the invoice store already knows.
            try:
                import invoice_parser
                store = invoice_parser.load_store(HERE / "data" / "invoices.json")
                gross = sum(
                    item["cents"]
                    for inv in store["invoices"]
                    for item in inv["line_items"]
                    if str(item["date"]).startswith(str(args.year))
                )
            except Exception:
                gross = 0
        print()
        print(report(ledger, args.year, gross))
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
