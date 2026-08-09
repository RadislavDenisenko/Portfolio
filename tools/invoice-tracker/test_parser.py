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

    # Switching to actual costs must flip which side is claimed.
    ledger["vehicle_method"] = "actual"
    s = tax.summarize(ledger, 2026)
    assert s["claimed_vehicle_cents"] == 5000 and s["excluded_cents"] == 14850

    # QBI: 20% of profit, but capped at 20% of what is left after the standard
    # deduction. At his income the cap is what binds, so a flat 20% is wrong.
    t = tax.estimate_tax(5_756_400, 800_000)
    assert t["net_profit_cents"] == 4_956_400
    assert t["qbi_deduction_cents"] > 0, "QBI missing — overstates the set-aside"
    taxable = t["net_profit_cents"] - round(t["se_tax_cents"] * 0.5) - tax.STANDARD_DEDUCTION_CENTS
    assert t["qbi_deduction_cents"] == round(taxable * 0.20), t["qbi_deduction_cents"]

    # A thin year owes nothing and must never go negative.
    assert tax.estimate_tax(500_000, 900_000)["total_tax_cents"] == 0
    assert tax.estimate_tax(0, 0)["effective_rate"] == 0.0

    print("tax math OK")


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
