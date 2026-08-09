"""Pull new invoice PDFs out of Gmail and fold them into the tracker's store.

Runs on a schedule (the invoices land on Thursdays) or by hand. Stdlib only.

Credentials come from the environment, or from a `secrets.json` sitting next to
this script — which .gitignore keeps out of the repo:

    {"user": "raddenisenko@gmail.com", "password": "abcd efgh ijkl mnop"}

That password is a Gmail **App Password**, not the account password. Make one at
https://myaccount.google.com/apppasswords (needs 2-step verification on).

    python3 fetch_invoices.py            # fetch anything new, update the store
    python3 fetch_invoices.py --since 01-Jun-2026
"""

from __future__ import annotations

import argparse
import email
import imaplib
import json
import os
import sys
from email.header import decode_header, make_header
from pathlib import Path

import invoice_parser

HERE = Path(__file__).parent
DATA = HERE / "data"
STORE = DATA / "invoices.json"
PDF_DIR = DATA / "pdf"


def credentials() -> tuple[str, str]:
    user = os.environ.get("INVOICE_EMAIL")
    password = os.environ.get("INVOICE_APP_PASSWORD")
    if not (user and password):
        secrets = HERE / "secrets.json"
        if secrets.exists():
            data = json.loads(secrets.read_text("utf-8"))
            user = user or data.get("user")
            password = password or data.get("password")
    if not (user and password):
        sys.exit(
            "No credentials. Set INVOICE_EMAIL and INVOICE_APP_PASSWORD, or write "
            f"{HERE / 'secrets.json'} with {{\"user\": ..., \"password\": ...}}."
        )
    return user, password


def subject_of(message) -> str:
    raw = message.get("Subject", "")
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def pdf_attachments(message):
    for part in message.walk():
        filename = part.get_filename() or ""
        if part.get_content_type() == "application/pdf" or filename.lower().endswith(".pdf"):
            payload = part.get_payload(decode=True)
            if payload:
                yield filename or "invoice.pdf", payload


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--since", default="01-Jan-2026", help="IMAP date, e.g. 01-Jun-2026")
    ap.add_argument("--query", default="INVOICE", help="text to match in the subject")
    ap.add_argument("--keep-pdfs", action="store_true", help="also archive the PDFs")
    args = ap.parse_args(argv)

    user, password = credentials()
    store = invoice_parser.load_store(STORE)
    seen = set(store.get("seen_messages", []))

    box = imaplib.IMAP4_SSL("imap.gmail.com")
    try:
        box.login(user, password)
        # All Mail so archived invoices still show up; INBOX if that name is absent.
        if box.select('"[Gmail]/All Mail"', readonly=True)[0] != "OK":
            box.select("INBOX", readonly=True)

        status, data = box.search(None, "SUBJECT", f'"{args.query}"', "SINCE", args.since)
        if status != "OK":
            print("IMAP search failed", file=sys.stderr)
            return 1

        ids = data[0].split()
        print(f"{len(ids)} message(s) matching subject {args.query!r} since {args.since}")

        added = 0
        for num in ids:
            status, raw = box.fetch(num, "(BODY.PEEK[])")
            if status != "OK" or not raw or not raw[0]:
                continue
            message = email.message_from_bytes(raw[0][1])
            message_id = message.get("Message-ID", "").strip()
            if message_id and message_id in seen:
                continue

            for filename, payload in pdf_attachments(message):
                try:
                    invoice = invoice_parser.parse(payload, source=filename)
                except Exception as exc:
                    print(f"  {filename}: unreadable ({exc})", file=sys.stderr)
                    continue
                if not invoice["line_items"]:
                    continue  # some other kind of PDF

                invoice["email_subject"] = subject_of(message)
                invoice["email_from"] = message.get("From", "")
                invoice["email_date"] = message.get("Date", "")
                if invoice_parser.merge(store, invoice):
                    added += 1
                    stats = invoice_parser.analyze(invoice)
                    print(
                        f"  + {invoice['pay_period']}: {stats['days_worked']} days, "
                        f"{stats['jobs']} jobs, "
                        f"{invoice_parser.cents_to_str(stats['net_cents'])}"
                    )
                if args.keep_pdfs:
                    PDF_DIR.mkdir(parents=True, exist_ok=True)
                    (PDF_DIR / f"{invoice['period_end'] or 'unknown'}.pdf").write_bytes(payload)

            if message_id:
                seen.add(message_id)
    finally:
        try:
            box.logout()
        except Exception:
            pass

    store["seen_messages"] = sorted(seen)
    invoice_parser.save_store(STORE, store)
    print(f"{added} new invoice(s); {len(store['invoices'])} total in {STORE}")

    if added:
        for invoice in store["invoices"][:1]:
            print()
            print(invoice_parser.report(invoice))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
