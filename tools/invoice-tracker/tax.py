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
import os
import re
from pathlib import Path

HERE = Path(__file__).parent
LEDGER = HERE / "data" / "ledger.json"

# IRS standard mileage rates, cents per mile, keyed by the date they take
# effect. A single constant is wrong: 2026 changed MID-YEAR (72.5c from Jan 1
# per IR-2025-128, raised to 76c from July 1 per IR-2026-29 on fuel prices), so
# a year's miles have to be split at June 30 and multiplied separately.
# VERIFIED 2026-08-09 against irs.gov/tax-professionals/standard-mileage-rates.
# Re-check there every January, and after any mid-year announcement.
MILEAGE_RATES = [
    ("2024-01-01", 67.0),
    ("2025-01-01", 70.0),
    ("2026-01-01", 72.5),
    ("2026-07-01", 76.0),
]

# Only business miles deduct. Rev. Rul. 99-7: driving between home and a work
# location is commuting and is not deductible - unless the home qualifies as the
# principal place of business, or the site is temporary and there is a regular
# work location elsewhere. Schedule C line 44 demands this split anyway.
MILE_KINDS = ("business", "commuting", "other")


def rate_for(date_iso: str) -> float:
    """Cents per mile in force on that date. ISO only, and it says so.

    These are compared as strings, so anything not YYYY-MM-DD sorts wrongly:
    '06/30/2026' lands below '2024-01-01' and used to price silently at 67c
    instead of 72.5c. The CLI then printed that wrong figure as confirmation,
    and `_year` - which also matches on the string - dropped the same entry from
    the year's report entirely. The miles were recorded, confirmed on screen,
    and then quietly missing from the deduction. Refuse instead.
    """
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(date_iso or "")):
        raise ValueError(
            f"{date_iso!r} is not a date I can price. Use YYYY-MM-DD, "
            "e.g. 2026-06-30."
        )
    rate = MILEAGE_RATES[0][1]
    for start, value in sorted(MILEAGE_RATES):   # not merely lucky ordering
        if date_iso >= start:
            rate = value
    return rate

# The "$75 rule" is NOT a licence to bin small receipts, and this is why there
# is no threshold anywhere in this file. Reg. §1.274-5(c)(2)(iii) waives the
# receipt below $75 only for what §274(d) covers: travel away from home, gifts,
# and listed property (the van). Lodging needs a receipt at ANY amount. Tools,
# supplies, phone and licences are ordinary §162 expenses governed by §6001,
# which sets no dollar floor at all - so for most of what he actually buys,
# there is no small-purchase exemption. Capture everything.
# VERIFIED 2026-08-09 against the regulation and 26 U.S.C. §274(d).
#
# Schedule C (Form 1040) Part II lines, trimmed to what a field technician
# driving to job sites actually incurs. `vehicle` marks the ones that standard
# mileage already covers.
CATEGORIES = {
    "mileage":    {"line": "9",   "label": "Car and truck expenses", "vehicle": True},
    "gas":        {"line": "9",   "label": "Car and truck - fuel", "vehicle": True},
    "repairs":    {"line": "9",   "label": "Car and truck - repairs", "vehicle": True},
    # Tolls and parking sit on line 9 with the rest of the vehicle costs but are
    # NOT part of the standard mileage rate - they are claimable on top of it.
    # Hence vehicle=False: it means "the mileage rate already covers this", and
    # for tolls it does not. SunPass on the run up to Sarasota is real money.
    "tolls":      {"line": "9",   "label": "Car and truck - tolls & parking", "vehicle": False},
    # IRS Topic 510 lists what the standard rate replaces: "gas, oil, repairs,
    # tires, insurance, registration fees, licenses, and depreciation (or lease
    # payments)". Only parking and tolls survive it. Every one of these needs a
    # home where it can be EXCLUDED, or a photographed tag renewal quietly gets
    # claimed twice - and this module's whole purpose is that it cannot.
    "van_insurance":  {"line": "9",  "label": "Car and truck - insurance", "vehicle": True},
    "registration":   {"line": "9",  "label": "Car and truck - tag & registration", "vehicle": True},
    "tires":          {"line": "9",  "label": "Car and truck - tires", "vehicle": True},
    "lease":          {"line": "9",  "label": "Car and truck - lease payments", "vehicle": True},
    "depreciation":   {"line": "13", "label": "Depreciation (Form 4562)", "vehicle": True},
    "insurance":  {"line": "15",  "label": "Insurance (not health, not the van)", "vehicle": False},
    "office":     {"line": "18",  "label": "Office expense", "vehicle": False},
    "supplies":   {"line": "22",  "label": "Supplies", "vehicle": False},
    "tools":      {"line": "22",  "label": "Supplies - tools", "vehicle": False},
    "licenses":   {"line": "23",  "label": "Taxes and licenses", "vehicle": False},
    "travel":     {"line": "24a", "label": "Travel", "vehicle": False},
    "meals":      {"line": "24b", "label": "Meals (50% deductible)", "vehicle": False},
    "phone":      {"line": "25",  "label": "Utilities - phone", "vehicle": False},
    "other":      {"line": "27a", "label": "Other expenses", "vehicle": False},
}

# Meals are half deductible; everything else here is fully deductible.
DEDUCTIBLE_FRACTION = {"meals": 0.5}

SE_TAX_RATE = 0.153          # 12.4% Social Security + 2.9% Medicare
SE_TAXABLE_FRACTION = 0.9235  # SE tax applies to 92.35% of net earnings
SE_DEDUCTION = 0.5            # half of SE tax is an income-tax deduction

# The two halves of SE tax behave differently and a flat 15.3% is wrong above
# the base. §1402(b)(1): the 12.4% Social Security half applies only to net
# earnings above "the contribution and benefit base ... minus ... the wages paid
# to such individual during such taxable year" - so **W-2 wages consume the base
# first**, which matters for a split year like his. Medicare's 2.9% is uncapped.
# 2026 base is $184,500 (SSA). Re-check each January with the mileage rates.
OASDI_RATE = 0.124
MEDICARE_RATE = 0.029
SS_WAGE_BASE_CENTS = 18_450_000

# §1401(b)(2): a further 0.9% Medicare above this, on wages plus SE earnings
# combined. Not deductible under §164(f), unlike the rest of SE tax.
ADDITIONAL_MEDICARE_RATE = 0.009
ADDITIONAL_MEDICARE_THRESHOLD_CENTS = 20_000_000

# §1402(b)(2): "the term 'self-employment income' does not include ... the net
# earnings from self-employment, if such net earnings for the taxable year are
# less than $400." The test is on the 92.35% figure, matching Schedule SE 4c.
SE_MINIMUM_CENTS = 40_000

# Qualified business income, §199A: a sole proprietor deducts 20% of business
# profit off taxable income on top of the standard deduction. Made permanent by
# the OBBBA. The wage/property limits only bite above the threshold below, which
# he is nowhere near, so the plain 20% applies. Forgetting it overstates what he
# needs to set aside by several hundred dollars a year.
QBI_RATE = 0.20
QBI_PHASE_IN_START_CENTS = 20_500_000  # single filer; above this the limits start
QBI_MINIMUM_CENTS = 40_000             # $400 floor if QBI >= $1,000 and he works it
QBI_MINIMUM_FLOOR_CENTS = 100_000

# 2026 federal brackets and standard deduction, single filer.
# VERIFIED 2026-08-09 against irs.gov (Rev. Proc. 2025-32, as amended by OBBBA).
# These were the 2025 figures until that check - re-verify every January.
STANDARD_DEDUCTION_CENTS = 1_610_000
BRACKETS = [
    (1_240_000, 0.10),
    (5_040_000, 0.12),
    (10_570_000, 0.22),
    (20_177_500, 0.24),
    (25_622_500, 0.32),
    (64_060_000, 0.35),
    (float("inf"), 0.37),
]


def load() -> dict:
    """Read the ledger, or refuse.

    It must NEVER quietly hand back an empty ledger when the file is unreadable.
    Every command is load -> mutate -> save, so returning `{}` from a damaged
    file meant the next save overwrote the damaged-but-still-present bytes with
    nothing, printed a cheerful success message, and destroyed the record for
    good. Unlike invoices.json none of this is re-fetchable: the real-estate
    fees, the prior-year safe-harbour figures and every odometer reading only
    exist here, and data/ is gitignored so there is no other copy.
    """
    if LEDGER.exists():
        raw = LEDGER.read_text("utf-8")
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            wreck = LEDGER.with_suffix(".corrupt")
            wreck.write_text(raw, "utf-8")
            raise SystemExit(
                f"\n{LEDGER} is damaged and I will not overwrite it.\n"
                f"  {exc}\n\n"
                f"A copy of exactly what was on disk is at:\n  {wreck}\n\n"
                "Nothing has been changed. Ask Claude to salvage it - the\n"
                "expenses and odometer readings are usually still in there.\n"
            )
    return {"expenses": [], "mileage": [], "vehicle_method": "standard"}


def save(ledger: dict) -> None:
    """Write the ledger atomically.

    A plain write_text truncates first, so a crash, a Ctrl+C or a full disk
    partway through leaves a half-written file - which `load` above would then
    refuse, blocking him until someone repairs it. Writing to a temporary file
    and renaming means the ledger on disk is always one whole version or the
    other, never a fragment.
    """
    ledger["expenses"].sort(key=lambda e: e.get("date") or "")
    ledger["mileage"].sort(key=lambda m: m.get("date") or "")
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    temp = LEDGER.with_suffix(".tmp")
    temp.write_text(json.dumps(ledger, indent=2) + "\n", "utf-8")
    os.replace(temp, LEDGER)   # atomic on Windows and POSIX alike


def money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents) // 100:,}.{abs(cents) % 100:02d}"


def to_cents(amount: str | float) -> int:
    """'45.99', '$45.99', 45.99 -> 4599. And '-47.32' or '($47.32)' -> -4732.

    The sign matters and used to be stripped along with the currency symbol, so
    a return slip from Home Depot - ordinary when a technician takes parts back -
    was booked as money spent rather than money refunded. It also made the
    "total is negative" check in receipts.py unreachable, since nothing could
    ever arrive negative. `invoice_parser.money_to_cents` already handled both
    forms; the two disagreed.
    """
    if isinstance(amount, (int, float)):
        return round(float(amount) * 100)
    text = str(amount).strip()
    negative = text.startswith("-") or "$-" in text or "-$" in text or (
        text.startswith("(") and text.endswith(")")
    )
    digits = re.sub(r"[^\d.]", "", text)
    if not digits:
        return 0
    value = round(float(digits) * 100)
    return -value if negative else value


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


def add_miles(
    ledger: dict,
    miles: float,
    date: str | None = None,
    purpose: str = "",
    kind: str = "business",
    route: str = "",
) -> dict:
    """Record a day's driving.

    A vehicle is listed property, so mileage falls under the strict
    substantiation of §274(d): amount, time, place and business purpose, all
    recorded at or near the time. Unlike ordinary expenses, a court may NOT
    estimate for you - an inadequate log is disallowed in full rather than
    trimmed. Hence `purpose` and `route`, and hence the nagging below.
    """
    entry = {
        "date": date or dt.date.today().isoformat(),
        "miles": round(float(miles), 1),
        "kind": kind if kind in MILE_KINDS else "business",
        "purpose": purpose.strip(),
        "route": route.strip(),
    }
    entry["complete"] = bool(entry["purpose"]) and bool(entry["route"])
    ledger["mileage"].append(entry)
    return entry


def workdays_from_invoices(store_path: Path | None = None) -> dict[str, list[str]]:
    """Which days he worked, and the job numbers, straight off the invoices.

    This is the business-purpose half of the mileage record, and it is the part
    that makes the whole thing defensible: §274(d) wants the date and the
    business purpose of each use, and "7 cable jobs, tickets 144158, 144203..." is
    exactly that - generated from a document Koscom issued, not from memory.
    """
    try:
        import invoice_parser
        store = invoice_parser.load_store(store_path or HERE / "data" / "invoices.json")
    except Exception:
        return {}
    days: dict[str, set[str]] = {}
    for invoice in store.get("invoices", []):
        for item in invoice.get("line_items", []):
            days.setdefault(str(item["date"]), set()).add(str(item["job"]))
    return {day: sorted(jobs) for day, jobs in sorted(days.items())}


def import_van_charges(ledger: dict, store_path: Path | None = None) -> int:
    """Pull the weekly TRUCK charge off the invoices into the ledger.

    He pays Koscom for the van and it is deducted on the invoice, which makes it
    the best-substantiated expense in the whole file - a third party issues the
    document, weekly, with the amount and period on its face. It was invisible
    to the tax side until now because adjustments live in invoices.json and the
    ledger only ever saw photographed receipts.

    Stored as `lease` (vehicle=True), so standard mileage correctly excludes it
    - §4.02 puts "depreciation or lease payments" among the costs the per-mile
    rate replaces - while company mode claims it at the business-use share.

    Idempotent: keyed on the invoice period, so re-running cannot double it.
    """
    try:
        import invoice_parser
        store = invoice_parser.load_store(store_path or HERE / "data" / "invoices.json")
    except Exception:
        return 0

    already = {e.get("source") for e in ledger["expenses"]}
    added = 0
    for invoice in store.get("invoices", []):
        period = invoice.get("period_end") or ""
        for adjustment in invoice.get("adjustments") or []:
            if adjustment.get("label") != "TRUCK":
                continue
            # Negative on the invoice because it is taken off his pay; an
            # expense to him is the positive amount. A $0.00 line is a week
            # they did not charge him, not a $0 expense.
            cents = abs(adjustment.get("cents") or 0)
            source = f"invoice:TRUCK:{period}"
            if not cents or source in already:
                continue
            add_expense(
                ledger, cents, "Koscom Networks - van charge", "lease", period,
                note=f"TRUCK line, week ending {period}",
                source=source, confidence="invoice",
            )
            # An invoice IS the documentary evidence; nothing to eyeball.
            ledger["expenses"][-1]["reviewed"] = True
            already.add(source)
            added += 1
    return added


def odometer_to_mileage(
    ledger: dict, store_path: Path | None = None, year: int | None = None
) -> dict:
    """Pair each day's odometer readings into one business trip for that day.

    The first reading of a day is leaving, the last is getting home, and the gap
    between them is the working day. Deliberately NOT the difference between one
    day's reading and the next day's - that would sweep in every evening errand
    and overstate business miles, which is the one direction it must never err.

    Idempotent: re-running replaces the trips it made last time and leaves
    anything hand-entered alone.
    """
    workdays = workdays_from_invoices(store_path)
    # None, not "". Every ISO date sorts above the empty string, so an empty
    # sentinel made the "no invoice yet" branch below fire for EVERY day - and a
    # missing or corrupt invoices.json (load_store swallows a decode error and
    # returns no invoices) turned a fortnight of personal errands into fully
    # substantiated business mileage, reporting no problems at all. An absent
    # proof set must prove nothing.
    last_invoiced = max(workdays) if workdays else None

    # Days already logged by hand. Generating a second trip for the same date
    # would double it, because rebuilding only replaces source=='odometer'
    # entries - and the fetcher rebuilds automatically whenever readings arrive.
    manual_days = {
        m["date"] for m in ledger.get("mileage", []) if m.get("source") != "odometer"
    }

    by_day: dict[str, list[dict]] = {}
    for reading in ledger.get("odometer", []):
        by_day.setdefault(reading["at"][:10], []).append(reading)

    trips, problems = [], []
    for day in sorted(by_day):
        readings = sorted(by_day[day], key=lambda r: r["at"])
        jobs = workdays.get(day)

        if day in manual_days:
            problems.append(
                f"{day}: you already logged this day by hand, so the odometer "
                "readings were left out rather than counted twice. Delete one."
            )
            continue

        if len(readings) < 2:
            problems.append(
                f"{day}: only one odometer reading, so there is no distance for "
                "that day. Send a second one next time - leaving and getting back."
            )
            continue

        # Pair them up consecutively - out and back, out and back - instead of
        # taking the widest span. Four readings mean he went out again in the
        # evening, and first-to-last would sweep that personal round trip into
        # the business total, which is the one direction this must never err.
        miles = sum(
            readings[i + 1]["reading"] - readings[i]["reading"]
            for i in range(0, len(readings) - 1, 2)
        )
        if len(readings) % 2:
            problems.append(
                f"{day}: {len(readings)} readings, which is an odd number, so the "
                "last one has no pair and was ignored. Send them two at a time."
            )
        if miles < 0:
            problems.append(
                f"{day}: the readings go backwards ({readings[0]['reading']} then "
                f"{readings[-1]['reading']}). One of them is a typo."
            )
            continue
        if miles == 0:
            problems.append(f"{day}: both readings are the same, so no miles were recorded.")
            continue
        if miles > 500:
            problems.append(
                f"{day}: {miles} miles in one day is far outside his normal ~63. "
                "Check the numbers before this goes anywhere near a return."
            )

        if jobs:
            purpose = f"{len(jobs)} cable job(s), ticket(s) {', '.join(jobs[:6])}"
            purpose += "..." if len(jobs) > 6 else ""
            kind = "business"
        elif last_invoiced and day > last_invoiced:
            # Invoices arrive ~2.5 weeks after the work, so recent days have no
            # invoice yet. That is a wait, not a problem.
            purpose = "worked - invoice not issued yet"
            kind = "business"
        else:
            problems.append(
                f"{day}: {miles} miles logged but no invoice shows work that day, so "
                "there is nothing to prove it was business. Left out of the total."
            )
            continue

        trips.append({
            "date": day,
            "miles": float(miles),
            "kind": kind,
            "purpose": purpose,
            "route": f"odometer {readings[0]['reading']} -> {readings[-1]['reading']}",
            "complete": True,
            "source": "odometer",
        })

    # Days he demonstrably worked but sent no readings - the deduction he is
    # losing, which is worth naming out loud. Filtered by the TAX year asked
    # about, not by today's calendar year: from January until he files, the year
    # that matters is the previous one, and those December days were silently
    # dropped from the nag exactly when he could still reconstruct them.
    want = year if year is not None else dt.date.today().year
    missing = [day for day in workdays if day not in by_day and _year(day, want)]

    kept = [m for m in ledger.get("mileage", []) if m.get("source") != "odometer"]
    ledger["mileage"] = sorted(kept + trips, key=lambda m: m["date"])

    return {
        "trips": len(trips),
        "miles": round(sum(t["miles"] for t in trips), 1),
        "problems": problems,
        "missing_days": missing,
        "last_invoiced": last_invoiced,
    }


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

    # Each entry is valued at the rate in force on its own date - 2026 splits
    # at July 1 - and only business miles count toward the deduction.
    miles_by_kind = {kind: 0.0 for kind in MILE_KINDS}
    mileage_cents = 0
    incomplete = 0
    for entry in ledger["mileage"]:
        if not _year(entry["date"], year):
            continue
        kind = entry.get("kind", "business")
        miles_by_kind[kind] = miles_by_kind.get(kind, 0.0) + entry["miles"]
        if kind == "business":
            mileage_cents += round(entry["miles"] * rate_for(entry["date"]))
            if not entry.get("complete"):
                incomplete += 1
    miles = miles_by_kind["business"]

    # The whole point of this module.
    vehicle_cents = sum(
        slot["deductible_cents"]
        for name, slot in by_category.items()
        if CATEGORIES[name]["vehicle"]
    )
    # Topic 510: with a vehicle used for both, "you may deduct only the cost of
    # its business use", so actual costs are scaled by the business share of the
    # miles. Claiming 100% both overstated the deduction and made the "switch
    # method" hint recommend the worse method, because it compared a full-cost
    # figure against a business-only mileage figure.
    total_miles = sum(miles_by_kind.values())
    business_share = (miles / total_miles) if total_miles else 0.0
    actual_cents = round(vehicle_cents * business_share)

    # Whose vehicle decides everything. Rev. Proc. 2019-46 §4.01 limits the
    # standard mileage rate to "an automobile that a taxpayer either owns or
    # leases", so for Koscom's van (or a rental) there is no per-mile claim at
    # all - but the gas he buys for it out of pocket, unreimbursed, is an
    # ordinary §162 business expense (§4.01's own fallback: actual costs
    # "allocable to traveling those business miles"). He has said plainly:
    # every gas receipt he sends is for the work vehicle. The old model
    # silently excluded that gas as "covered by mileage" when no mileage claim
    # existed or ever could.
    #
    # VERIFIED 2026-08-10, two edges that survive adversarial review:
    # - If the van COMMUTES (goes home with him), the fuel for those miles is
    #   personal under §262 / Rev. Rul. 99-7 and must be allocated out by the
    #   mileage ratio. If the van stays at the shop, 100% stands. UNRESOLVED -
    #   see HANDOFF 5c before filing a return on this.
    # - §274(d) substantiation attaches to fuel for listed property he does not
    #   own; a receipt alone lacks the business-use element. Escape hatch:
    #   §274(i) qualified nonpersonal use vehicle (branded, permanent racking).
    if not ledger.get("owns_vehicle", False):
        mode = "company"
        # The van goes home with him every night, so part of every tank is
        # commuting - personal under §262 / Rev. Rul. 99-7. But his warehouse
        # stop every morning is a regular work location, so under Rev. Rul.
        # 99-7 exception (2) the ONLY personal leg is home->warehouse (21 mi);
        # the drive home from the last job is business.
        #
        # Best evidence first: if odometer readings exist, each workday's
        # business miles are that day's total minus the fixed commute leg -
        # measured, contemporaneous, and §1.274-5T-shaped. Without readings,
        # fall back to the stored estimate. 1.0 would be wrong in the
        # direction that loses audits.
        commute = ledger.get("van_commute_miles_per_day", 0.0)
        odo_days = [
            m for m in ledger.get("mileage", [])
            if m.get("source") == "odometer" and m.get("kind") == "business"
            and _year(m["date"], year)
        ]
        if odo_days and commute:
            total_odo = sum(m["miles"] for m in odo_days)
            business_odo = sum(max(0.0, m["miles"] - commute) for m in odo_days)
            business_share = (business_odo / total_odo) if total_odo else 0.0
        else:
            business_share = ledger.get("van_business_share", 1.0)
        claimed_vehicle = round(vehicle_cents * business_share)
        alternative = 0
        excluded = mileage_cents + (vehicle_cents - claimed_vehicle)
    elif method == "standard":
        mode = "standard"
        claimed_vehicle, alternative = mileage_cents, actual_cents
        excluded = vehicle_cents
    else:
        mode = "actual"
        claimed_vehicle, alternative = actual_cents, mileage_cents
        excluded = mileage_cents

    non_vehicle = sum(
        slot["deductible_cents"]
        for name, slot in by_category.items()
        if not CATEGORIES[name]["vehicle"]
    )

    return {
        "method": method,
        "mode": mode,
        "by_category": by_category,
        "miles": round(miles, 1),
        "miles_by_kind": {k: round(v, 1) for k, v in miles_by_kind.items()},
        "incomplete_trips": incomplete,
        "mileage_cents": mileage_cents,
        "vehicle_expense_cents": vehicle_cents,
        "business_share": round(business_share, 4),
        "claimed_vehicle_cents": claimed_vehicle,
        # What the OTHER method would be worth, already scaled. The switch hint
        # must compare against this, never against the raw cost total.
        "alternative_cents": alternative,
        "excluded_cents": excluded,
        "non_vehicle_cents": non_vehicle,
        "total_deduction_cents": claimed_vehicle + non_vehicle,
        "unreviewed": sum(
            1 for e in ledger["expenses"] if not e.get("reviewed") and _year(e["date"], year)
        ),
    }


def estimate_tax(
    gross_cents: int,
    deduction_cents: int,
    wage_cents: int = 0,
    withheld_cents: int = 0,
) -> dict:
    """Rough federal estimate for a single filer in Florida (no state income tax).

    Handles a **split year**, which is his actual 2026: wages from a job for part
    of it, then contracting for the rest. The two are taxed differently and
    mixing them up gets the answer badly wrong:

      - Self-employment tax hits ONLY the business profit. Wages already had
        Social Security and Medicare taken out at source, so taxing them again
        here would roughly double-count.
      - Income tax hits BOTH together, so the wages push the business profit up
        into higher brackets. Ignoring them understates the bill.
      - The §199A deduction is 20% of BUSINESS income only. Wages do not qualify.
      - Tax already withheld from those wages comes straight off the total.

    An estimate for setting money aside, not a return. It ignores credits,
    dependants, and anything else a real preparer would apply.
    """
    # NOT clamped at zero. A net Schedule C loss is an above-the-line deduction
    # under §62(a)(1), so it reduces AGI and offsets W-2 wages dollar for dollar
    # (Schedule 1 line 3 is allowed to be negative). Clamping here would throw
    # the loss away - and a pure loss is exactly his real-estate business:
    # $2,062.25 of brokerage and MLS fees against zero commission.
    net_profit = gross_cents - deduction_cents

    # The clamp belongs here instead: §1402(a) charges no SE tax on a loss.
    se_earnings = round(max(0, net_profit) * SE_TAXABLE_FRACTION)
    if se_earnings < SE_MINIMUM_CENTS:
        se_tax_base = 0
    else:
        oasdi_room = max(0, SS_WAGE_BASE_CENTS - wage_cents)
        se_tax_base = (
            round(min(se_earnings, oasdi_room) * OASDI_RATE)
            + round(se_earnings * MEDICARE_RATE)
        )

    combined = wage_cents + se_earnings
    extra_medicare = (
        round((combined - ADDITIONAL_MEDICARE_THRESHOLD_CENTS) * ADDITIONAL_MEDICARE_RATE)
        if combined > ADDITIONAL_MEDICARE_THRESHOLD_CENTS else 0
    )
    se_tax = se_tax_base + extra_medicare

    # §164(f) deducts half of SE tax - but not the Additional Medicare part.
    half_se = round(se_tax_base * SE_DEDUCTION)
    taxable = max(0, wage_cents + net_profit - half_se - STANDARD_DEDUCTION_CENTS)

    # §199A comes off after the standard deduction and is capped at 20% of what
    # is left, so a thin year gets less than 20% of profit - that cap is the
    # usual case for him, not the exception.
    qbi = max(0, net_profit - half_se)
    qbi_deduction = min(round(qbi * QBI_RATE), round(taxable * QBI_RATE))
    if qbi >= QBI_MINIMUM_FLOOR_CENTS:
        qbi_deduction = max(qbi_deduction, QBI_MINIMUM_CENTS)
    qbi_deduction = min(qbi_deduction, taxable)
    taxable -= qbi_deduction

    income_tax = 0
    last = 0
    for ceiling, rate in BRACKETS:
        if taxable <= last:
            break
        income_tax += round((min(taxable, ceiling) - last) * rate)
        last = ceiling

    total = se_tax + income_tax
    base = max(0, wage_cents + net_profit)
    return {
        "net_profit_cents": net_profit,
        "wage_cents": wage_cents,
        "se_tax_cents": se_tax,
        "qbi_deduction_cents": qbi_deduction,
        "income_tax_cents": income_tax,
        "total_tax_cents": total,
        "withheld_cents": withheld_cents,
        # What he actually has to find. The withholding is already gone from his
        # paychecks, so the bill he must fund is the remainder.
        "still_owed_cents": max(0, total - withheld_cents),
        "effective_rate": total / base if base else 0.0,
        "quarterly_cents": round(total / 4),
    }


# The four 1040-ES dates for 2026. None fall on a weekend or holiday, so none
# shift. VERIFIED 2026-08-09.
ESTIMATE_DUE = ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]

# §6654(d)(1)(C): the prior-year safe harbour becomes 110% only above this much
# prior-year AGI. A fixed statutory figure - it is NOT inflation-indexed.
SAFE_HARBOR_110_THRESHOLD_CENTS = 15_000_000

# §6654(e)(1): no penalty at all if the year's tax, less withholding, is under
# this. Nothing is withheld from his invoices, so this rarely saves him.
DE_MINIMIS_CENTS = 100_000


def safe_harbor(
    bill_cents: int,
    prior_year_tax_cents: int | None = None,
    prior_year_filed: bool = True,
    prior_year_agi_cents: int = 0,
    withheld_cents: int = 0,
    paid_cents: int = 0,
) -> dict:
    """How little he can pay in during the year and still owe no penalty.

    §6654(d)(1)(B): the required annual payment is the **lesser** of 90% of this
    year's tax or 100% of the tax shown on last year's return. For someone whose
    income jumped - a W-2 year followed by a contracting year - the prior-year
    figure is dramatically smaller, and it is the whole game.

    Two conditions people miss, both fatal if assumed:
      - the final sentence of §6654(d)(1)(B) voids the prior-year option
        entirely if he **did not file** last year, and
      - §6654(d)(1)(C) raises it to 110% above $150,000 of prior-year AGI.

    This buys protection from the penalty and nothing else. The tax itself is
    still owed on April 15, which is the part that actually hurts.
    """
    ninety = round(bill_cents * 0.90)

    prior_option = None
    if prior_year_filed and prior_year_tax_cents is not None:
        multiplier = 1.10 if prior_year_agi_cents > SAFE_HARBOR_110_THRESHOLD_CENTS else 1.00
        prior_option = round(prior_year_tax_cents * multiplier)

    required = ninety if prior_option is None else min(ninety, prior_option)

    # §6654(g)(1) spreads withholding evenly across the year no matter when it
    # actually came out - but that grace is for "the credit allowed under
    # section 31", i.e. wage withholding ONLY. An estimated payment counts on
    # the day it is made and is credited to the oldest unpaid instalment, so
    # pooling the two here treated a September cheque as though it had been
    # sitting there since April. They are reported separately for that reason.
    covered = withheld_cents + paid_cents
    still_needed = max(0, required - covered)

    return {
        "bill_cents": bill_cents,
        "ninety_percent_cents": ninety,
        "prior_year_option_cents": prior_option,
        "required_annual_cents": required,
        "which": "prior year" if prior_option is not None and prior_option < ninety else "90% of this year",
        "installment_cents": round(required / 4),
        "already_covered_cents": covered,
        "withheld_cents": withheld_cents,
        "estimated_paid_cents": paid_cents,
        # True once any instalment due date has passed with nothing paid: a
        # payment now caps the interest but cannot undo what has accrued, and
        # saying "this stops the penalty" would be a lie.
        "late_installments": paid_cents == 0 and dt.date.today() > dt.date(
            dt.date.today().year, 4, 15
        ),
        "pay_by_sept_15_cents": still_needed,
        "due_next_april_cents": max(0, bill_cents - covered - still_needed),
        "exempt": bill_cents - withheld_cents < DE_MINIMIS_CENTS,
    }


SUMMARY = HERE / "data" / "tax-summary.json"


def invoice_income(year: int, store_path: Path | None = None) -> dict:
    """What the invoices say he has been paid, and where the year is heading.

    Projected forward at his own average rather than annualising from a single
    week, because his weeks swing by hundreds of dollars and a bad projection
    is what makes someone stop trusting the number.
    """
    try:
        import invoice_parser
        store = invoice_parser.load_store(store_path or HERE / "data" / "invoices.json")
    except Exception:
        return {"received_cents": 0, "weeks": 0, "projected_cents": 0, "per_week_cents": 0}

    received, weeks = 0, 0
    for invoice in store.get("invoices", []):
        items = [i for i in invoice.get("line_items", []) if str(i["date"]).startswith(str(year))]
        if items:
            received += sum(i["cents"] for i in items)
            weeks += 1

    per_week = round(received / weeks) if weeks else 0
    today = dt.date.today()
    # Invoices land about 2.5 weeks after the work, so weeks still to be paid
    # for is what is left of the year plus that lag.
    remaining = max(0, (dt.date(year, 12, 31) - today).days // 7) if today.year == year else 0
    return {
        "received_cents": received,
        "weeks": weeks,
        "per_week_cents": per_week,
        "projected_cents": received + per_week * remaining,
        "weeks_remaining": remaining,
    }


def snapshot(ledger: dict, year: int | None = None) -> dict:
    """Everything the dashboard shows, computed once, here.

    The browser deliberately does no tax arithmetic of its own. `pdf_text.py`
    and `assets/pdf-extract.js` already have to be kept in step by hand and that
    is one hand-port too many; a second one where the two copies disagree about
    what he owes is not a bug anyone would catch.
    """
    year = year or dt.date.today().year
    stats = summarize(ledger, year)
    income = invoice_income(year)

    wages = ledger.get("wage_cents", 0)
    withheld = ledger.get("withheld_cents", 0)
    paid = ledger.get("estimated_paid_cents", 0)

    estimate = estimate_tax(
        income["projected_cents"], stats["total_deduction_cents"], wages, withheld
    )

    prior = ledger.get("prior_year") or {}
    harbor = None
    if prior.get("total_tax_cents") is not None:
        harbor = safe_harbor(
            estimate["total_tax_cents"], prior.get("total_tax_cents"),
            prior.get("filed", True), prior.get("agi_cents", 0), withheld, paid,
        )

    try:
        import fetch_invoices
        receipts = fetch_invoices.load_receipts()["receipts"]
    except Exception:
        receipts = []
    buckets: dict[str, int] = {}
    for r in receipts:
        buckets[r.get("status", "?")] = buckets.get(r.get("status", "?"), 0) + 1

    # On a copy, and told which tax year it is reporting on: reporting must
    # neither write to the ledger nor answer about a different year.
    mileage = odometer_to_mileage(dict(ledger), year=year)

    # If the van belongs to the company there is no vehicle deduction at all, so
    # counting "days with no odometer reading" would be nagging him about money
    # he was never entitled to. Wrong advice is worse than none: he would start
    # logging a number that can never be claimed, and stop trusting the rest.
    owns_vehicle = ledger.get("owns_vehicle", False)
    if not owns_vehicle:
        mileage = dict(mileage, problems=[], missing_days=[])

    deadline = dt.date(year + 1, 4, 15)
    weeks_left = max(1, (deadline - dt.date.today()).days // 7)
    owed = estimate["still_owed_cents"] - (harbor["pay_by_sept_15_cents"] if harbor else 0)

    return {
        "generated": dt.datetime.now().isoformat(timespec="minutes"),
        "year": year,
        "income": income,
        "wages_cents": wages,
        "withheld_cents": withheld,
        "deductions": {
            "total_cents": stats["total_deduction_cents"],
            "by_category": {
                name: {
                    "label": CATEGORIES[name]["label"],
                    "line": CATEGORIES[name]["line"],
                    "cents": slot["deductible_cents"],
                    "count": slot["count"],
                    "excluded": CATEGORIES[name]["vehicle"] and stats["mode"] == "standard",
                }
                for name, slot in stats["by_category"].items()
            },
            "miles": stats["miles"],
            "mileage_cents": stats["mileage_cents"],
            "method": stats["method"],
        },
        "estimate": estimate,
        "safe_harbor": harbor,
        "set_aside_per_week_cents": max(0, round(owed / weeks_left)),
        "weeks_until_due": weeks_left,
        "receipts": buckets,
        "owns_vehicle": owns_vehicle,
        "mileage_problems": mileage["problems"],
        "missing_mileage_days": mileage["missing_days"],
        "unreviewed": stats["unreviewed"],
    }


def write_snapshot(ledger: dict, year: int | None = None) -> Path:
    SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY.write_text(json.dumps(snapshot(ledger, year), indent=2) + "\n", "utf-8")
    return SUMMARY


def report(ledger: dict, year: int | None = None, gross_cents: int = 0) -> str:
    stats = summarize(ledger, year)
    out: list[str] = []
    label = year or "all years"
    out.append(f"  DEDUCTIONS - {label}")
    out.append("  " + "-" * 52)

    for name, slot in sorted(
        stats["by_category"].items(), key=lambda kv: -kv[1]["deductible_cents"]
    ):
        info = CATEGORIES[name]
        excluded = info["vehicle"] and stats["mode"] == "standard"
        tag = "  (covered by mileage)" if excluded else ""
        out.append(
            f"  {info['label']:<34}{money(slot['deductible_cents']):>10}"
            f"  x{slot['count']}{tag}"
        )

    out.append("")
    kinds = stats["miles_by_kind"]
    out.append(
        f"  {stats['miles']:,.1f} business miles"
        f"  ->{money(stats['mileage_cents']):>13}"
    )
    if kinds.get("commuting") or kinds.get("other"):
        out.append(
            f"  ({kinds.get('commuting', 0):,.1f} commuting and "
            f"{kinds.get('other', 0):,.1f} personal, neither deductible)"
        )
    elif stats["miles"]:
        out.append(
            "  ! Every mile is logged as business and none as commuting.\n"
            "    Home to your first job of the day is normally commuting and is\n"
            "    NOT deductible - unless your home qualifies as your principal\n"
            "    place of business. That one question is worth more than every\n"
            "    receipt combined; settle it with a preparer."
        )
    if stats["incomplete_trips"]:
        out.append(
            f"  ! {stats['incomplete_trips']} trip(s) have no purpose or route recorded.\n"
            "    A vehicle is listed property: an incomplete log is disallowed in\n"
            "    full, not reduced. Add where you went and why."
        )
    if stats["mode"] == "standard" and stats["vehicle_expense_cents"]:
        out.append(
            f"  Van costs of {money(stats['vehicle_expense_cents'])} are NOT claimed "
            "separately -\n  standard mileage already covers fuel, repairs and "
            "depreciation."
        )
    if stats["mode"] == "company" and stats["vehicle_expense_cents"] and stats["business_share"] < 1:
        held_back = stats["vehicle_expense_cents"] - stats["claimed_vehicle_cents"]
        out.append(
            f"  Van costs counted at {stats['business_share']:.0%} business use - "
            f"{money(held_back)} of them is\n  the drive to and from home, which is "
            "commuting and not deductible."
        )
    out.append("  " + "-" * 52)
    out.append(f"  {'TOTAL DEDUCTION':<34}{money(stats['total_deduction_cents']):>10}")

    # Whichever method is worth more is the one to claim. Say so rather than
    # letting the default quietly cost him money.
    # Compare against the business-use-scaled alternative, and never fire on an
    # empty mileage log: with no business miles the actual method is worth 0% of
    # the costs, not 100%, and the old comparison invented upside that a switch
    # would have destroyed.
    gap = stats["alternative_cents"] - stats["claimed_vehicle_cents"]
    if gap > 0 and stats["miles"]:
        other = "actual van costs" if stats["mode"] == "standard" else "standard mileage"
        out.append("")
        out.append(
            f"  ! Claiming {other} instead would be worth {money(gap)} more this year.\n"
            f"    Switch with:  python3 tax.py method "
            f"{'actual' if stats['method'] == 'standard' else 'standard'}\n"
            "    Check with a preparer first - the first year you use a vehicle\n"
            "    can lock you out of switching later."
        )

    if stats["unreviewed"]:
        out.append("")
        out.append(f"  ! {stats['unreviewed']} scanned item(s) still need a quick look.")

    if gross_cents:
        wages = ledger.get("wage_cents", 0)
        withheld = ledger.get("withheld_cents", 0)
        tax = estimate_tax(gross_cents, stats["total_deduction_cents"], wages, withheld)
        out.append("")
        out.append(f"  TAX ESTIMATE on {money(gross_cents)} of invoices")
        out.append("  " + "-" * 52)
        if wages:
            out.append(f"  {'Plus W-2 wages this year':<34}{money(wages):>10}")
        out.append(f"  {'Net profit after deductions':<34}{money(tax['net_profit_cents']):>10}")
        out.append(f"  {'Self-employment tax':<34}{money(tax['se_tax_cents']):>10}")
        out.append(
            f"  {'Business income deduction (20%)':<34}"
            f"{money(-tax['qbi_deduction_cents']):>10}"
        )
        out.append(f"  {'Federal income tax':<34}{money(tax['income_tax_cents']):>10}")
        out.append(f"  {'TOTAL tax for the year':<34}{money(tax['total_tax_cents']):>10}")
        if withheld:
            out.append(f"  {'Already withheld from wages':<34}{money(-withheld):>10}")
            out.append(f"  {'LEFT TO FIND':<34}{money(tax['still_owed_cents']):>10}")
        out.append(
            f"  {'Effective rate':<34}{tax['effective_rate'] * 100:>9.1f}%"
        )
        # The MARGINAL value, worked out by asking what the bill would have been
        # with no deductions at all. The average effective rate is dragged down
        # by the standard deduction and the untaxed floor, and understated this
        # by about a third - and this is the only line that tells him whether
        # chasing receipts is worth the trouble.
        without = estimate_tax(gross_cents, 0, wages, withheld)
        saved = without["total_tax_cents"] - tax["total_tax_cents"]
        out.append("")
        out.append(f"  Those deductions saved you {money(saved)}.")

        prior = ledger.get("prior_year") or {}
        if prior.get("total_tax_cents") is not None:
            sh = safe_harbor(
                tax["total_tax_cents"],
                prior.get("total_tax_cents"),
                prior.get("filed", True),
                prior.get("agi_cents", 0),
                ledger.get("withheld_cents", 0),
                ledger.get("estimated_paid_cents", 0),
            )
            out.append("")
            out.append("  WHAT TO PAY, AND WHEN")
            out.append("  " + "-" * 52)
            out.append(
                f"  {'Penalty-free if you pay in':<34}"
                f"{money(sh['required_annual_cents']):>10}  ({sh['which']})"
            )
            if sh["already_covered_cents"]:
                out.append(
                    f"  {'Already covered':<34}{money(sh['already_covered_cents']):>10}"
                )
            out.append(f"  {'Pay by September 15':<34}{money(sh['pay_by_sept_15_cents']):>10}")
            out.append(f"  {'Then due April 15':<34}{money(sh['due_next_april_cents']):>10}")
            # Was hardcoded to 35, which was right only in the week it was
            # written and understated by 6x if he ran the report in March.
            deadline = dt.date((year or dt.date.today().year) + 1, 4, 15)
            weeks = max(1, (deadline - dt.date.today()).days // 7)
            out.append("")
            out.append(
                "  A payment now stops the interest running from here on. It does not\n"
                "  cancel it: the April and June instalments were already late, so a\n"
                "  few dollars have accrued whatever you do. And it does NOT shrink\n"
                f"  the bill - {money(sh['due_next_april_cents'])} still lands in April, about "
                f"{money(round(sh['due_next_april_cents'] / weeks))} a week\n"
                f"  across the {weeks} weeks left. That is the number that matters; the\n"
                "  penalty was never more than pocket change."
            )

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
    m.add_argument("--purpose", default="", help="why, specifically: 'service call, ticket 88213'")
    m.add_argument("--route", default="", help="from where to where")
    m.add_argument("--kind", default="business", choices=MILE_KINDS)

    r = sub.add_parser("report", help="deductions and tax estimate")
    r.add_argument("--year", type=int, default=dt.date.today().year)
    r.add_argument("--gross", help="invoice income, e.g. 57000")

    v = sub.add_parser("method", help="standard mileage or actual vehicle costs")
    v.add_argument("choice", choices=["standard", "actual"])

    o = sub.add_parser("odometer", help="record a reading, or rebuild the log from them")
    o.add_argument("reading", nargs="?", type=int, help="what the dash says right now")
    o.add_argument("--at", help="ISO datetime; defaults to now")

    p = sub.add_parser("prior", help="last year's return - the safe-harbour numbers")
    p.add_argument("--tax", required=True, help="Form 1040 line 24, total tax")
    p.add_argument("--agi", default="0", help="Form 1040 line 11, adjusted gross income")
    p.add_argument("--not-filed", action="store_true", help="he did NOT file last year")
    p.add_argument("--withheld", default="0", help="tax withheld from wages THIS year")
    p.add_argument("--paid", default="0", help="estimated tax already paid THIS year")

    j = sub.add_parser("job", help="a W-2 job this year: wages and tax withheld")
    j.add_argument("--wages", required=True, help="box 1, wages")
    j.add_argument("--withheld", required=True, help="box 2, federal income tax withheld")

    sub.add_parser("snapshot", help="write data/tax-summary.json for the dashboard")

    veh = sub.add_parser("vehicle", help="whose van is it? decides the mileage deduction")
    veh.add_argument("whose", choices=["mine", "company"])

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
        entry = add_miles(ledger, args.miles, args.date, args.purpose, args.kind, args.route)
        save(ledger)
        worth = round(entry["miles"] * rate_for(entry["date"])) if entry["kind"] == "business" else 0
        print(
            f"Recorded {entry['miles']} {entry['kind']} miles on {entry['date']}"
            + (f" = {money(worth)} off your taxable income" if worth else " (not deductible)")
        )
        if entry["kind"] == "business" and not entry["complete"]:
            print("  Add --purpose and --route: an incomplete log is disallowed in full.")
    elif args.command == "method":
        ledger["vehicle_method"] = args.choice
        save(ledger)
        print(f"Vehicle method set to {args.choice}.")
    elif args.command == "job":
        ledger["wage_cents"] = to_cents(args.wages)
        ledger["withheld_cents"] = to_cents(args.withheld)
        save(ledger)
        write_snapshot(ledger)
        print(
            f"W-2 wages {money(ledger['wage_cents'])}, "
            f"{money(ledger['withheld_cents'])} already withheld."
        )
        print("Run  python tax.py report  to see what that changes.")
    elif args.command == "snapshot":
        path = write_snapshot(ledger)
        print(f"Wrote {path}")
    elif args.command == "vehicle":
        ledger["owns_vehicle"] = args.whose == "mine"
        save(ledger)
        write_snapshot(ledger)
        if ledger["owns_vehicle"]:
            print(
                "Your van. Every business mile is now deductible - email yourself\n"
                "the odometer with the subject MILES, leaving and getting home."
            )
        else:
            print(
                "The company's van, so there is no mileage deduction and nothing\n"
                "to log. Tell me the day you buy your own - that is worth more\n"
                "than every receipt put together."
            )
    elif args.command == "prior":
        ledger["prior_year"] = {
            "total_tax_cents": to_cents(args.tax),
            "agi_cents": to_cents(args.agi),
            "filed": not args.not_filed,
        }
        ledger["withheld_cents"] = to_cents(args.withheld)
        ledger["estimated_paid_cents"] = to_cents(args.paid)
        save(ledger)
        print(
            f"Last year: {money(ledger['prior_year']['total_tax_cents'])} total tax on "
            f"{money(ledger['prior_year']['agi_cents'])} of income"
            + ("" if ledger["prior_year"]["filed"] else "  (NOT FILED - no safe harbour)")
        )
        print("Run  python tax.py report  to see what to pay.")
    elif args.command == "odometer":
        if args.reading is not None:
            ledger.setdefault("odometer", []).append({
                "at": args.at or dt.datetime.now().isoformat(timespec="minutes"),
                "reading": args.reading,
                "message_id": "",
            })
            ledger["odometer"].sort(key=lambda r: r["at"])
        result = odometer_to_mileage(ledger)
        save(ledger)
        print(
            f"{len(ledger.get('odometer', []))} reading(s) -> {result['trips']} day(s), "
            f"{result['miles']:,.0f} business miles"
        )
        for problem in result["problems"]:
            print(f"  ! {problem}")
        if result["missing_days"]:
            days = result["missing_days"]
            worth = round(sum(63 * rate_for(d) for d in days))
            print(
                f"\n  {len(days)} day(s) you worked with no odometer readings at all.\n"
                f"  At your usual ~63 miles that is about {money(worth)} of deduction\n"
                f"  you cannot claim: {', '.join(days[:8])}" + ("..." if len(days) > 8 else "")
            )
    else:
        gross = to_cents(args.gross) if args.gross else 0
        if not gross:
            # The PROJECTED year, not just what has landed so far - the same
            # figure the dashboard uses. Summing only the invoices received to
            # date answers "what have I earned", but the question this report
            # exists to answer is "what will I owe", and in August that made the
            # two screens disagree by thousands.
            income = invoice_income(args.year)
            gross = income["projected_cents"]
            if income["weeks"]:
                print(
                    f"\n  Projecting {money(gross)} for {args.year}: "
                    f"{money(income['received_cents'])} received over "
                    f"{income['weeks']} week(s), then {income['weeks_remaining']} "
                    f"more at {money(income['per_week_cents'])}."
                )
        print()
        print(report(ledger, args.year, gross))
        print()
        # Keep the dashboard in step without making him remember a second step.
        write_snapshot(ledger, args.year)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
