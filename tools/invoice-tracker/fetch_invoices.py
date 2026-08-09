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
import ctypes
import email
import getpass
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

# The password lives outside the repository. This one is public, and a file
# sitting in the working tree is one `git add -f` or one edited .gitignore away
# from being published forever.
if os.name == "nt":
    CONFIG = Path(os.environ.get("APPDATA") or Path.home() / "AppData/Roaming") / "invoice-tracker"
else:
    CONFIG = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "invoice-tracker"

SECRET = CONFIG / "gmail.dat"        # DPAPI-encrypted, Windows
SECRET_PLAIN = CONFIG / "gmail.json"  # everywhere else
LEGACY = HERE / "secrets.json"        # the old in-repo location, migrated on sight


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data: bytes, protect: bool) -> bytes | None:
    """Encrypt/decrypt with Windows DPAPI, tied to the logged-in account.

    Returns None anywhere that isn't Windows, so callers fall back to a plain
    file with tight permissions.
    """
    if os.name != "nt":
        return None
    try:
        crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    except (AttributeError, OSError):
        return None
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = _Blob()
    call = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    if not call(ctypes.byref(blob_in), None, None, None, None, 0, ctypes.byref(blob_out)):
        return None
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(blob_out.pbData)


def _write_secret(user: str, password: str) -> Path:
    CONFIG.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"user": user, "password": password}).encode("utf-8")
    sealed = _dpapi(payload, protect=True)
    path = SECRET if sealed else SECRET_PLAIN
    path.write_bytes(sealed or payload)
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return path


def _read_secret() -> tuple[str | None, str | None]:
    for path in (SECRET, SECRET_PLAIN):
        if not path.exists():
            continue
        raw = path.read_bytes()
        if path is SECRET:
            raw = _dpapi(raw, protect=False) or b""
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        return data.get("user"), data.get("password")
    return None, None


def forget() -> None:
    """Erase every stored copy of the credential."""
    gone = []
    for path in (SECRET, SECRET_PLAIN, LEGACY):
        if path.exists():
            path.unlink()
            gone.append(str(path))
    print("Deleted: " + (", ".join(gone) if gone else "nothing was stored"))
    print("Revoke the app password itself at https://myaccount.google.com/apppasswords")


def credentials() -> tuple[str, str]:
    """Environment, then the stored secret, then ask — and remember the answer."""
    user = os.environ.get("INVOICE_EMAIL")
    password = os.environ.get("INVOICE_APP_PASSWORD")

    if not (user and password):
        stored_user, stored_password = _read_secret()
        user, password = user or stored_user, password or stored_password

    # An older version kept this inside the repo. Move it out and delete it.
    if not (user and password) and LEGACY.exists():
        try:
            data = json.loads(LEGACY.read_text("utf-8"))
            user, password = user or data.get("user"), password or data.get("password")
        except (json.JSONDecodeError, OSError):
            pass
        if user and password:
            path = _write_secret(user, password.replace(" ", ""))
            LEGACY.unlink()
            print(f"Moved your Gmail password out of the repo to {path}")
            print(f"Deleted {LEGACY}\n")

    if user and password:
        return user, password.replace(" ", "")

    if not sys.stdin.isatty():
        sys.exit(
            "No credentials. Run this once by hand to set them up, or set "
            "INVOICE_EMAIL and INVOICE_APP_PASSWORD."
        )

    print("First run — I need a Gmail App Password (not your normal password).")
    print("Make one at https://myaccount.google.com/apppasswords, then paste it below.")
    user = user or input("Gmail address: ").strip()
    if not password:
        # getpass hides the paste, which surprises people the first time.
        password = getpass.getpass("App password (nothing will appear as you paste): ")
    password = password.replace(" ", "").strip()
    if not (user and password):
        sys.exit("Need both an address and a password.")
    # The prompt is blind, so say what landed. Pasting twice is the usual mishap.
    if len(password) == 16:
        print("  Got 16 characters — that is the right shape.")
    else:
        print(
            f"  ! Got {len(password)} characters, and app passwords are 16.\n"
            "    32 means it went in twice — the prompt shows nothing while you paste.\n"
            "    Anything else means it was probably your normal password.\n"
            "    Carry on and see, or Ctrl+C and delete secrets.json to redo it."
        )

    path = _write_secret(user, password)
    where = "encrypted with your Windows login" if path is SECRET else "readable only by you"
    print(f"Saved to {path} — {where}, and outside the repo entirely.\n")
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
    ap.add_argument("--forget", action="store_true", help="delete the stored password and exit")
    args = ap.parse_args(argv)

    if args.forget:
        forget()
        return 0

    user, password = credentials()
    store = invoice_parser.load_store(STORE)
    seen = set(store.get("seen_messages", []))

    try:
        # Without a timeout an unreachable host hangs until the user gives up.
        box = imaplib.IMAP4_SSL("imap.gmail.com", timeout=30)
    except OSError as exc:
        sys.exit(
            f"\nCould not reach imap.gmail.com: {exc}\n\n"
            "That is the network, not the password. Check the internet connection,\n"
            "and any VPN, firewall or antivirus that might block port 993.\n"
        )

    try:
        try:
            box.login(user, password)
        except imaplib.IMAP4.error as exc:
            # A traceback here tells the user nothing they can act on.
            sys.exit(
                f"\nGmail rejected the login: {exc}\n\n"
                "It is almost always one of these three:\n\n"
                "  1. That was your normal Gmail password. It has to be an App Password:\n"
                "     https://myaccount.google.com/apppasswords  (16 letters, and it needs\n"
                "     2-Step Verification switched on first.)\n\n"
                "  2. IMAP is turned off. Gmail > Settings > See all settings >\n"
                "     Forwarding and POP/IMAP > Enable IMAP > Save Changes.\n\n"
                f"  3. The saved password is wrong. Delete this file and run again:\n"
                f"     {HERE / 'secrets.json'}\n"
            )
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
