"""Smallest thing that fails if the money math or the job counting breaks.

    python3 test_parser.py

Point it at a real invoice to check the PDF side too:

    python3 test_parser.py path/to/I0F8.pdf
"""

import sys
import tempfile
from pathlib import Path

from invoice_parser import analyze, jobs_needed, money_to_cents, parse, parse_rows

# Two days. Day one bills job 100 twice and job 101 once -> 2 jobs, not 3.
ROWS = [
    ["TECH #", "NAME", "PAY PERIOD"],
    ["I0F8", "Denisenko, Radislav", "July 05-11, 2026"],
    ["DATE", "CODE", "JOB"],
    ["2026-07-06", "R.T.8.", "100", "$38.25"],
    ["2026-07-06", "E.B.5.", "100", "$14.68"],
    ["2026-07-06", "R.Q.2.", "101", "$47.25"],
    ["2026-07-11", "R.T.8.", "102", "$38.25"],
    ["TOTAL JOBS", "$138.43"],
    ["SOFT FEE", "-$6.25"],
    ["TOTAL PAY", "$132.18"],
]


def _sandbox():
    """Point the ledger and the receipt index at a throwaway dir.

    His real ledger is the record behind a tax return. A test must never be able
    to write to it, however the test is invoked.
    """
    import fetch_invoices
    import tax

    tmp = Path(tempfile.mkdtemp()) / "data"
    (tmp / "inbox").mkdir(parents=True)
    tax.LEDGER = tmp / "ledger.json"
    fetch_invoices.DATA = tmp
    fetch_invoices.INBOX = tmp / "inbox"
    fetch_invoices.RECEIPT_INDEX = tmp / "receipts.json"
    return tmp


def check_tax() -> None:
    """The numbers that decide what he sets aside."""
    import tax

    _sandbox()

    # 2026 split the business rate mid-year. Getting the side of June 30 wrong
    # silently misprices every mile he drove.
    assert tax.rate_for("2026-06-30") == 72.5
    assert tax.rate_for("2026-07-01") == 76.0
    assert tax.rate_for("2025-12-31") == 70.0

    # Verified against irs.gov 2026-08-09. These were the 2025 figures once.
    assert tax.STANDARD_DEDUCTION_CENTS == 1_610_000
    assert tax.BRACKETS[0] == (1_240_000, 0.10)
    assert tax.BRACKETS[1] == (5_040_000, 0.12)

    ledger = tax.load()
    tax.add_miles(ledger, 100, "2026-06-30", "job sites", "business", "a to b")
    tax.add_miles(ledger, 100, "2026-07-01", "job sites", "business", "a to b")
    tax.add_miles(ledger, 500, "2026-07-02", "school run", "other", "home")
    s = tax.summarize(ledger, 2026)
    assert s["mileage_cents"] == 7250 + 7600, s["mileage_cents"]
    assert s["miles"] == 200.0                    # personal miles stay out
    assert s["miles_by_kind"]["other"] == 500.0

    # The rule the module exists for: standard mileage swallows fuel and repairs,
    # and does NOT swallow tolls.
    tax.add_expense(ledger, 5000, "Wawa", "gas", "2026-07-02")
    tax.add_expense(ledger, 1240, "SunPass", "tolls", "2026-07-02")
    tax.add_expense(ledger, 4732, "Home Depot", "tools", "2026-07-02")
    s = tax.summarize(ledger, 2026)
    assert s["excluded_cents"] == 5000, s["excluded_cents"]
    assert s["by_category"]["tolls"]["deductible_cents"] == 1240
    assert s["total_deduction_cents"] == 14850 + 1240 + 4732, s["total_deduction_cents"]

    # Switching to actual costs flips which side is claimed - and scales the
    # costs by BUSINESS USE. 200 business miles against 500 personal is 28.57%,
    # so $50 of fuel is worth $14.29, not the whole $50. Claiming 100% both
    # overstated the deduction and made the switch hint recommend the worse
    # method, because it compared full costs against business-only mileage.
    ledger["vehicle_method"] = "actual"
    s = tax.summarize(ledger, 2026)
    assert abs(s["business_share"] - 200 / 700) < 0.0001, s["business_share"]
    assert s["claimed_vehicle_cents"] == round(5000 * 200 / 700), s["claimed_vehicle_cents"]
    assert s["excluded_cents"] == 14850

    # With no business miles at all, actual costs are worth 0% - never 100% -
    # and the "you should switch" hint must not fire on imaginary upside.
    empty = tax.load()
    tax.add_expense(empty, 30000, "Wawa", "gas", "2026-07-03")
    assert tax.summarize(empty, 2026)["alternative_cents"] == 0
    assert "would be worth" not in tax.report(empty, 2026)

    # Van insurance and the tag are covered by the standard rate (Topic 510), so
    # they must be EXCLUDED, not stacked on top of the mileage deduction.
    van = tax.load()
    tax.add_miles(van, 63, "2026-07-01", "cable jobs", "business", "80000-80063")
    tax.add_expense(van, 128400, "Progressive", "van_insurance", "2026-08-01")
    tax.add_expense(van, 32500, "FL Tax Collector", "registration", "2026-07-06")
    sv = tax.summarize(van, 2026)
    assert sv["excluded_cents"] == 160900, sv["excluded_cents"]
    assert sv["total_deduction_cents"] == sv["mileage_cents"], sv

    # QBI: 20% of profit, but capped at 20% of what is left after the standard
    # deduction. At his income the cap is what binds, so a flat 20% is wrong.
    t = tax.estimate_tax(5_756_400, 800_000)
    assert t["net_profit_cents"] == 4_956_400
    assert t["qbi_deduction_cents"] > 0, "QBI missing - overstates the set-aside"
    taxable = t["net_profit_cents"] - round(t["se_tax_cents"] * 0.5) - tax.STANDARD_DEDUCTION_CENTS
    assert t["qbi_deduction_cents"] == round(taxable * 0.20), t["qbi_deduction_cents"]

    # A thin year owes nothing and must never go negative.
    assert tax.estimate_tax(500_000, 900_000)["total_tax_cents"] == 0
    assert tax.estimate_tax(0, 0)["effective_rate"] == 0.0

    # A SPLIT YEAR, which is his actual 2026: wages Jan-May, contracting after.
    split = tax.estimate_tax(3_100_500, 206_225, wage_cents=1_020_000, withheld_cents=70_000)
    only_se = tax.estimate_tax(3_100_500, 206_225)
    # SE tax must be identical HERE -- wages already had FICA taken at source,
    # so taxing them again would double-count. True only while wages plus SE
    # earnings stay under the Social Security base; above it §1402(b)(1) makes
    # the wages eat the base and SE tax FALLS, which check_audit_fixes pins.
    assert split["se_tax_cents"] == only_se["se_tax_cents"], (split, only_se)
    assert 1_020_000 + split["net_profit_cents"] < tax.SS_WAGE_BASE_CENTS
    # ...but income tax must be HIGHER, because the wages push the profit up
    # through the brackets. Ignoring them understates the bill.
    assert split["income_tax_cents"] > only_se["income_tax_cents"]
    # Withholding comes off what he still has to find, not off the tax itself.
    assert split["still_owed_cents"] == split["total_tax_cents"] - 70_000
    # QBI is 20% of BUSINESS income; wages never qualify.
    assert split["qbi_deduction_cents"] <= round((3_100_500 - 206_225) * 0.20)

    # A pure-wage year owes no SE tax at all.
    wages_only = tax.estimate_tax(0, 0, wage_cents=2_446_500, withheld_cents=169_900)
    assert wages_only["se_tax_cents"] == 0, wages_only
    assert wages_only["qbi_deduction_cents"] == 0

    # The safe harbour. His real 2025: $873 total tax on $24,465 of income,
    # against a projected 2026 bill near $4,950.
    sh = tax.safe_harbor(495_329, prior_year_tax_cents=87_300, prior_year_agi_cents=2_446_500)
    assert sh["required_annual_cents"] == 87_300, sh   # the LESSER wins
    assert sh["which"] == "prior year"
    assert sh["pay_by_sept_15_cents"] == 87_300
    assert sh["due_next_april_cents"] == 495_329 - 87_300

    # Not filing last year voids the prior-year option entirely - the final
    # sentence of §6654(d)(1)(B), and the easiest condition in the code to miss.
    unfiled = tax.safe_harbor(495_329, 87_300, prior_year_filed=False)
    assert unfiled["required_annual_cents"] == round(495_329 * 0.90), unfiled
    assert unfiled["which"] == "90% of this year"

    # Above $150k of prior-year AGI it becomes 110%, not 100%.
    rich = tax.safe_harbor(9_000_000, 500_000, prior_year_agi_cents=20_000_000)
    assert rich["required_annual_cents"] == 550_000, rich

    # Withheld wages count as paid evenly across the year, §6654(g).
    covered = tax.safe_harbor(495_329, 87_300, withheld_cents=90_000)
    assert covered["pay_by_sept_15_cents"] == 0, covered

    print("tax math OK")


def check_audit_fixes() -> None:
    """One case per bug the adversarial audit confirmed on 2026-08-09.

    Every one of these was reproducible and put a wrong number somewhere real.
    """
    import json

    import receipts
    import tax

    tmp = _sandbox()

    # [1] A Schedule C loss is above the line under §62(a)(1) and offsets wages.
    # Clamping it to zero threw away his entire real-estate loss.
    loss = tax.estimate_tax(0, 206_225, wage_cents=2_446_500)
    assert loss["net_profit_cents"] == -206_225, loss
    assert loss["income_tax_cents"] < tax.estimate_tax(0, 0, wage_cents=2_446_500)["income_tax_cents"]
    assert loss["se_tax_cents"] == 0, "no SE tax on a loss, §1402(a)"

    # [2] §1402(b)(2): no SE tax under $400 of net earnings.
    assert tax.estimate_tax(40_000, 0)["se_tax_cents"] == 0      # $369.40 earnings
    assert tax.estimate_tax(43_313, 0)["se_tax_cents"] > 0       # just over $400

    # [3] §1402(b)(1): the 12.4% half stops at the base, and WAGES EAT IT FIRST.
    big = tax.estimate_tax(50_000_000, 0)
    earnings = round(50_000_000 * tax.SE_TAXABLE_FRACTION)
    assert big["se_tax_cents"] < round(earnings * 0.153), "no wage-base cap"
    capped = tax.estimate_tax(10_000_000, 0, wage_cents=tax.SS_WAGE_BASE_CENTS)
    uncapped = tax.estimate_tax(10_000_000, 0, wage_cents=0)
    assert capped["se_tax_cents"] < uncapped["se_tax_cents"], "wage offset ignored"

    # [10] A date it cannot price must be refused, not quietly charged at 2024.
    assert tax.rate_for("2026-07-01") == 76.0
    for bad in ("06/30/2026", "", "yesterday"):
        try:
            tax.rate_for(bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"rate_for({bad!r}) should refuse")

    # [15] to_cents must keep the sign, or a refund becomes a deduction.
    assert tax.to_cents("-47.32") == -4732
    assert tax.to_cents("($47.32)") == -4732
    assert tax.to_cents("$47.32") == 4732

    # [17] A damaged ledger must never be silently replaced by an empty one.
    tax.LEDGER.write_text("{not json", "utf-8")
    try:
        tax.load()
    except SystemExit:
        pass
    else:
        raise AssertionError("a corrupt ledger was loaded as empty - it would be overwritten")
    assert tax.LEDGER.read_text("utf-8") == "{not json", "the damaged file was altered"
    assert tax.LEDGER.with_suffix(".corrupt").exists(), "no copy kept"
    tax.LEDGER.unlink()

    # [18] Writes are atomic - no .tmp left behind, and the file is whole.
    ledger = tax.load()
    tax.add_expense(ledger, 1000, "Test", "tools", "2026-07-01")
    tax.save(ledger)
    assert not tax.LEDGER.with_suffix(".tmp").exists()
    json.loads(tax.LEDGER.read_text("utf-8"))

    # [12] Filing the same receipt twice must not deduct it twice.
    import fetch_invoices
    index = fetch_invoices.load_receipts()
    index["receipts"].append({
        "id": "dup1", "file": "dup1.jpg", "received": "2026-08-01", "email_subject": "RCPT",
        "email_date": "", "bytes": 1, "status": "needs extraction",
        "extracted": None, "problems": [],
    })
    fetch_invoices.save_receipts(index)
    receipts.main(["record", "dup1", "--merchant", "Staples", "--date", "2026-08-01",
                   "--total", "20.00"])
    before = len(tax.load()["expenses"])
    receipts.main(["ok", "dup1"])
    receipts.main(["ok", "dup1"])          # the re-run a nervous user makes
    assert len(tax.load()["expenses"]) == before + 1, "same receipt filed twice"

    print("audit fixes OK")


def check_odometer() -> None:
    """Odometer readings into a mileage log that cannot overstate the miles."""
    import json

    import tax

    tmp = _sandbox()

    # A fake invoice store: he worked the 1st, 2nd and 6th. Not the 3rd.
    store = tmp / "invoices.json"
    store.write_text(json.dumps({"invoices": [{"line_items": [
        {"date": "2026-07-01", "job": "100", "cents": 1},
        {"date": "2026-07-01", "job": "101", "cents": 1},
        {"date": "2026-07-02", "job": "102", "cents": 1},
        {"date": "2026-07-06", "job": "103", "cents": 1},
        {"date": "2026-07-08", "job": "104", "cents": 1},
    ]}]}), "utf-8")

    assert tax.workdays_from_invoices(store) == {
        "2026-07-01": ["100", "101"], "2026-07-02": ["102"],
        "2026-07-06": ["103"], "2026-07-08": ["104"],
    }

    def reading(at, value):
        ledger.setdefault("odometer", []).append(
            {"at": at, "reading": value, "message_id": at}
        )

    ledger = tax.load()
    reading("2026-07-01T07:10", 80_000)      # left
    reading("2026-07-01T18:40", 80_063)      # home: 63 miles
    reading("2026-07-02T07:00", 80_100)      # only one reading all day
    reading("2026-07-03T08:00", 80_200)      # not a workday
    reading("2026-07-03T19:00", 80_400)
    reading("2026-07-06T07:00", 80_500)      # readings reversed
    reading("2026-07-06T19:00", 80_400)
    result = tax.odometer_to_mileage(ledger, store)

    assert result["trips"] == 1, result
    assert result["miles"] == 63.0, result
    trip = ledger["mileage"][0]
    assert trip["date"] == "2026-07-01"
    # The invoice supplies the business purpose. That is the whole trick.
    assert "100" in trip["purpose"] and "101" in trip["purpose"], trip["purpose"]
    assert trip["complete"] and trip["kind"] == "business"

    joined = " | ".join(result["problems"])
    assert "only one odometer reading" in joined
    assert "no invoice shows work that day" in joined     # the 3rd is excluded
    assert "backwards" in joined
    # The 200 miles on the non-workday must NOT reach the total.
    assert result["miles"] == 63.0

    # Idempotent, and it must not eat a hand-entered trip.
    tax.add_miles(ledger, 12, "2026-07-09", "supply run", "business", "depot")
    for _ in range(3):
        again = tax.odometer_to_mileage(ledger, store)
    assert again["trips"] == 1, again
    assert len(ledger["mileage"]) == 2, ledger["mileage"]
    assert any(m.get("source") != "odometer" for m in ledger["mileage"])

    # A day he worked and sent nothing at all is named, because that is lost
    # money. Days whose readings were broken are a different failure and are
    # reported through `problems` instead, so they must NOT show up here.
    assert result["missing_days"] == ["2026-07-08"], result["missing_days"]

    # A day after the last invoice still counts - invoices lag ~2.5 weeks.
    reading("2026-08-01T07:00", 81_000)
    reading("2026-08-01T18:00", 81_070)
    fresh = tax.odometer_to_mileage(ledger, store)
    assert fresh["miles"] == 133.0, fresh
    late = [m for m in ledger["mileage"] if m["date"] == "2026-08-01"][0]
    assert "invoice not issued yet" in late["purpose"]

    print("odometer checks OK")


def check_snapshot() -> None:
    """What the dashboard reads. Two things matter: it must never write to the
    ledger, and it must not nag about mileage he cannot claim."""
    import json

    import tax

    tmp = _sandbox()
    tax.SUMMARY = tmp / "tax-summary.json"

    ledger = tax.load()
    tax.add_expense(ledger, 12875, "Keller Williams", "licenses", "2026-01-09")
    ledger["prior_year"] = {"total_tax_cents": 87_300, "agi_cents": 2_446_500, "filed": True}
    ledger["wage_cents"] = 1_019_400
    ledger["withheld_cents"] = 70_800
    ledger["odometer"] = [
        {"at": "2026-07-01T07:00", "reading": 80_000, "message_id": "a"},
        {"at": "2026-07-01T18:00", "reading": 80_063, "message_id": "b"},
    ]
    tax.save(ledger)

    before = tax.LEDGER.read_text("utf-8")
    snap = tax.snapshot(tax.load(), 2026)
    assert tax.LEDGER.read_text("utf-8") == before, "snapshot() wrote to the ledger"

    assert snap["year"] == 2026
    assert snap["wages_cents"] == 1_019_400
    assert snap["safe_harbor"]["required_annual_cents"] == 87_300
    assert snap["estimate"]["still_owed_cents"] == (
        snap["estimate"]["total_tax_cents"] - 70_800
    )
    assert snap["deductions"]["by_category"]["licenses"]["cents"] == 12875

    # The company's van: no mileage deduction, so no nagging about a log he
    # cannot use. Telling him he is losing miles he was never entitled to is
    # worse than saying nothing.
    assert snap["owns_vehicle"] is False
    assert snap["missing_mileage_days"] == []
    assert snap["mileage_problems"] == []

    # His own van: the nagging comes back on.
    ledger = tax.load()
    ledger["owns_vehicle"] = True
    tax.save(ledger)
    owned = tax.snapshot(tax.load(), 2026)
    assert owned["owns_vehicle"] is True

    path = tax.write_snapshot(tax.load(), 2026)
    reloaded = json.loads(path.read_text("utf-8"))
    assert reloaded["year"] == 2026, "snapshot must round-trip through JSON"

    print("snapshot checks OK")


def check_receipts() -> None:
    """The validators, which are the only thing standing between a misread
    digit and a wrong number on a return."""
    import fetch_invoices
    import receipts
    import tax

    _sandbox()

    def seed(rid, name):
        index = fetch_invoices.load_receipts()
        index["receipts"].append({
            "id": rid, "file": name, "received": "2026-08-09", "email_subject": "RCPT",
            "email_date": "", "bytes": 1, "status": "needs extraction",
            "extracted": None, "problems": [],
        })
        fetch_invoices.save_receipts(index)

    for rid in ("aaa1", "bbb2", "ccc3", "ddd4"):
        seed(rid, f"{rid}.jpg")

    def record(rid, merchant, date, total, items="", tax_amount=""):
        receipts.main(["record", rid, "--merchant", merchant, "--date", date,
                       "--total", total, "--items", items, "--tax", tax_amount])
        return receipts.find(fetch_invoices.load_receipts(), rid)

    # Merchant rules, not a model, decide the category.
    assert receipts.categorise("THE HOME DEPOT #6349") == "tools"
    assert receipts.categorise("SUNPASS TOLL") == "tolls"
    assert receipts.categorise("Wawa 5512") == "gas"
    assert receipts.categorise("Some Place Nobody Knows") == "other"

    good = record("aaa1", "Home Depot", "2026-08-01", "47.32", "22.15,22.15", "3.02")
    assert good["problems"] == [] and good["status"] == "ready", good

    bad = record("bbb2", "AutoZone", "2026-08-02", "99.99", "10.00,20.00")
    assert any("off by" in p for p in bad["problems"]), bad
    assert bad["status"] == "needs a look"

    future = record("ccc3", "Wawa", "2099-01-01", "40.00")
    assert any("future" in p for p in future["problems"])

    dupe = record("ddd4", "Home Depot", "2026-08-01", "47.32", "22.15,22.15", "3.02")
    assert any("duplicate" in p for p in dupe["problems"]), dupe

    # Only the clean one may file itself, and it lands unreviewed.
    receipts.main(["ok", "--all"])
    ledger = tax.load()
    assert len(ledger["expenses"]) == 1, ledger["expenses"]
    entry = ledger["expenses"][0]
    assert entry["reviewed"] is False and entry["confidence"] == "scanned"
    assert entry["source"] == "aaa1.jpg", "the image must stay the record"

    print("receipt checks OK")


def main() -> int:
    assert money_to_cents("$38.25") == 3825
    assert money_to_cents("-$6.25") == -625
    assert money_to_cents("($6.25)") == -625
    assert money_to_cents("$1,530.56") == 153056

    inv = parse_rows(ROWS, "fixture")
    assert inv["tech_id"] == "I0F8", inv["tech_id"]
    assert inv["pay_period"] == "July 05-11, 2026"
    assert (inv["period_start"], inv["period_end"]) == ("2026-07-05", "2026-07-11")
    assert len(inv["line_items"]) == 4
    assert inv["adjustments"] == [{"label": "SOFT FEE", "cents": -625}]

    s = analyze(inv)
    assert s["days_worked"] == 2, s["days_worked"]
    assert s["jobs"] == 3, s["jobs"]           # 100 and 101 on Monday, 102 on Saturday
    assert s["lines"] == 4
    assert s["days"][0]["jobs"] == 2           # the repeated job number counts once
    assert s["days"][0]["cents"] == 3825 + 1468 + 4725
    assert s["gross_cents"] == 13843
    assert s["net_cents"] == 13843 - 625
    assert s["gross_discrepancy_cents"] == 0   # matches the printed TOTAL JOBS

    # 3 jobs over $138.43 is $46.14 each; netting $900 over 5 days needs
    # (90000 + 625) / 4614 = 19.64 jobs, so 3.93 a day.
    need = jobs_needed(90000, 5, s["cents_per_job"], s["adjustments_cents"])
    assert abs(need["jobs_per_day"] - 3.93) < 0.01, need

    # A printed total that disagrees with the lines has to be reported, not hidden.
    bad = parse_rows([r for r in ROWS if r[0] != "TOTAL JOBS"] + [["TOTAL JOBS", "$138.36"]])
    assert analyze(bad)["gross_discrepancy_cents"] == 7

    print("core math OK")
    check_tax()
    check_audit_fixes()
    check_odometer()
    check_snapshot()
    check_receipts()

    if len(sys.argv) > 1:
        path = Path(sys.argv[1])
        real = parse(path.read_bytes(), source=path.name)
        stats = analyze(real)
        assert real["line_items"], "no pay lines extracted from the PDF"
        assert stats["printed_gross_cents"] is not None, "no printed total found"
        print(
            f"{path.name}: {stats['lines']} lines, {stats['jobs']} jobs over "
            f"{stats['days_worked']} days, lines total "
            f"{stats['gross_cents'] / 100:.2f} vs printed "
            f"{stats['printed_gross_cents'] / 100:.2f}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
