"""Smallest thing that fails if the money math or the job counting breaks.

    python3 test_parser.py

Point it at a real invoice to check the PDF side too:

    python3 test_parser.py path/to/I0F8.pdf
"""

import sys
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
