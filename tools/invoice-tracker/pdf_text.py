"""Pull positioned text out of a PDF, using nothing but the standard library.

The invoices arrive as Quartz-generated PDFs whose fonts are subsetted, so the
bytes inside the content stream are glyph indices like ``!"#$`` rather than
letters. Each font carries a ``/ToUnicode`` CMap that maps those indices back to
real characters, and this module walks that indirection so the rest of the
tracker can work with plain strings.

Every cell on the invoice is drawn as its own positioned text run, so returning
runs with their device-space coordinates is enough to rebuild the table: group
by y to get rows, sort by x to get columns.

The same algorithm is implemented in ``assets/pdf-extract.js`` for the browser.
Keep the two in sync.
"""

from __future__ import annotations

import re
import zlib
from dataclasses import dataclass

# ---------------------------------------------------------------- lexing


def _lex_string(buf: bytes, i: int) -> tuple[bytes, int]:
    """Read a ``(literal string)`` starting at ``buf[i] == '('``."""
    i += 1
    depth = 1
    out = bytearray()
    while i < len(buf):
        c = buf[i]
        if c == 0x5C:  # backslash
            i += 1
            if i >= len(buf):
                break
            e = buf[i]
            simple = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12}
            if e in simple:
                out.append(simple[e])
                i += 1
            elif 0x30 <= e <= 0x37:  # octal escape, up to three digits
                digits = ""
                while i < len(buf) and len(digits) < 3 and 0x30 <= buf[i] <= 0x37:
                    digits += chr(buf[i])
                    i += 1
                out.append(int(digits, 8) & 0xFF)
            elif e == 0x0A:  # line continuation
                i += 1
            else:
                out.append(e)
                i += 1
            continue
        if c == 0x28:
            depth += 1
        elif c == 0x29:
            depth -= 1
            if depth == 0:
                return bytes(out), i + 1
        out.append(c)
        i += 1
    return bytes(out), i


_NAME_RE = re.compile(rb"/([^\s/\[\]<>(){}%]*)")
_NUM_RE = re.compile(rb"[-+]?(?:\d+\.?\d*|\.\d+)")
_OP_RE = re.compile(rb"[^\s/\[\]<>(){}%]+")
_WHITESPACE = b" \t\r\n\f\x00"


def _lex(buf: bytes):
    """Yield ``(kind, value)`` tokens from a content stream."""
    i, n = 0, len(buf)
    while i < n:
        c = buf[i : i + 1]
        if c in _WHITESPACE:
            i += 1
        elif c == b"%":
            nl = buf.find(b"\n", i)
            i = n if nl < 0 else nl + 1
        elif c == b"(":
            s, i = _lex_string(buf, i)
            yield "str", s
        elif buf[i : i + 2] == b"<<":
            yield "op", "<<"
            i += 2
        elif buf[i : i + 2] == b">>":
            yield "op", ">>"
            i += 2
        elif c == b"<":
            end = buf.find(b">", i)
            if end < 0:
                break
            hexed = re.sub(rb"\s", b"", buf[i + 1 : end])
            if len(hexed) % 2:
                hexed += b"0"
            try:
                yield "str", bytes.fromhex(hexed.decode("ascii"))
            except ValueError:
                yield "str", b""
            i = end + 1
        elif c == b"/":
            m = _NAME_RE.match(buf, i)
            yield "name", m.group(1).decode("latin-1")
            i = m.end()
        elif c in b"[]":
            yield "op", c.decode("ascii")
            i += 1
        else:
            m = _NUM_RE.match(buf, i)
            if m and m.end() > i:
                yield "num", float(m.group(0))
                i = m.end()
                continue
            m = _OP_RE.match(buf, i)
            if m:
                yield "op", m.group(0).decode("latin-1")
                i = m.end()
            else:
                i += 1


# ------------------------------------------------- objects and streams


def _index_objects(buf: bytes) -> dict[int, int]:
    """Map object number to the offset just past its ``N G obj`` header.

    Scanning beats following the xref table here: it still works when a PDF has
    a stale or slightly malformed xref, and these invoices are small.
    """
    objs: dict[int, int] = {}
    for m in re.finditer(rb"(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b", buf):
        objs[int(m.group(1))] = m.end()
    return objs


def _obj_header(buf: bytes, off: int) -> bytes:
    """Return the dictionary/value bytes of the object starting at ``off``."""
    end_stream = buf.find(b"stream", off)
    end_obj = buf.find(b"endobj", off)
    if end_obj < 0:
        end_obj = len(buf)
    if 0 <= end_stream < end_obj:
        return buf[off:end_stream]
    return buf[off:end_obj]


def _stream_bytes(buf: bytes, off: int) -> bytes | None:
    """Return the decoded stream payload of the object starting at ``off``."""
    m = re.compile(rb"stream\r\n|stream\n|stream\r").search(buf, off)
    if not m:
        return None
    header = buf[off : m.start()]
    end = buf.find(b"endstream", m.end())
    raw = buf[m.end() : end if end >= 0 else len(buf)]
    if b"/FlateDecode" in header:
        try:
            # decompressobj tolerates the trailing EOL before `endstream`.
            return zlib.decompressobj().decompress(raw)
        except zlib.error:
            try:
                return zlib.decompressobj(-15).decompress(raw)
            except zlib.error:
                return None
    return raw


# --------------------------------------------------------- ToUnicode maps


def _utf16be(hexed: str) -> str:
    try:
        return bytes.fromhex(hexed).decode("utf-16-be", "ignore")
    except ValueError:
        return ""


def _utf16be_plus(hexed: str, delta: int) -> str:
    """``hexed`` shifted by ``delta`` in its final UTF-16 code unit."""
    try:
        units = [int(hexed[i : i + 4], 16) for i in range(0, len(hexed), 4)]
    except ValueError:
        return ""
    if not units:
        return ""
    units[-1] += delta
    return "".join(chr(u) for u in units if 0 <= u <= 0x10FFFF)


def _parse_cmap(text: str) -> dict[int, str]:
    """Turn a ToUnicode CMap into ``{glyph code: text}``."""
    cmap: dict[int, str] = {}
    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            cmap[int(src, 16)] = _utf16be(dst)
    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
        pattern = r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[(.*?)\])"
        for m in re.finditer(pattern, block, re.S):
            lo, hi = int(m.group(1), 16), int(m.group(2), 16)
            if hi < lo or hi - lo > 0xFFFF:
                continue
            if m.group(3) is not None:
                for step, code in enumerate(range(lo, hi + 1)):
                    cmap[code] = _utf16be_plus(m.group(3), step)
            else:
                for step, dst in enumerate(re.findall(r"<([0-9A-Fa-f]+)>", m.group(4))):
                    cmap[lo + step] = _utf16be(dst)
    return cmap


# ------------------------------------------------------ matrices and runs

Matrix = tuple[float, float, float, float, float, float]
_IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def _mul(m: Matrix, n: Matrix) -> Matrix:
    a1, b1, c1, d1, e1, f1 = m
    a2, b2, c2, d2, e2, f2 = n
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


@dataclass
class TextRun:
    """One drawn string, with where it starts and ends in device space."""

    x: float
    x_end: float
    y: float
    size: float
    text: str


@dataclass
class Font:
    """The two things we need from a font: what glyphs mean and how wide they are."""

    cmap: dict[int, str]
    widths: dict[int, float]

    def decode(self, raw: bytes) -> str:
        if self.cmap:
            return "".join(self.cmap.get(b, "") for b in raw)
        return raw.decode("latin-1")

    def width(self, code: int) -> float:
        """Advance width in text-space units (1/1000 em)."""
        return self.widths.get(code, 500.0)


def _parse_widths(header: bytes) -> dict[int, float]:
    """Read ``/FirstChar`` and ``/Widths`` into ``{glyph code: width}``."""
    first = re.search(rb"/FirstChar\s+(\d+)", header)
    arr = re.search(rb"/Widths\s*\[([^\]]*)\]", header, re.S)
    if not first or not arr:
        return {}
    start = int(first.group(1))
    values = [float(v) for v in re.findall(rb"[-+]?\d+\.?\d*", arr.group(1))]
    return {start + i: w for i, w in enumerate(values)}


def extract_runs(pdf: bytes) -> list[TextRun]:
    """Return every text run in the PDF, in content-stream order."""
    objs = _index_objects(pdf)

    def resolve(ref: int) -> bytes | None:
        off = objs.get(ref)
        return None if off is None else _obj_header(pdf, off)

    # Locate the page and its font resources.
    resources = b""
    for off in objs.values():
        header = _obj_header(pdf, off)
        if b"/Type" in header and re.search(rb"/Type\s*/Page\b", header):
            m = re.search(rb"/Resources\s+(\d+)\s+0\s+R", header)
            if m:
                resources = resolve(int(m.group(1))) or b""
            else:
                m = re.search(rb"/Resources\s*(<<.*)", header, re.S)
                resources = m.group(1) if m else b""
            break

    fonts: dict[str, Font] = {}
    fm = re.search(rb"/Font\s*<<(.*?)>>", resources, re.S)
    if fm:
        for name, num in re.findall(rb"/([^\s/]+)\s+(\d+)\s+0\s+R", fm.group(1)):
            header = resolve(int(num)) or b""
            cmap: dict[int, str] = {}
            tu = re.search(rb"/ToUnicode\s+(\d+)\s+0\s+R", header)
            if tu:
                off = objs.get(int(tu.group(1)))
                data = _stream_bytes(pdf, off) if off is not None else None
                if data:
                    cmap = _parse_cmap(data.decode("latin-1"))
            fonts[name.decode("latin-1")] = Font(cmap, _parse_widths(header))

    # Concatenate the page content streams.
    content = b""
    for off in objs.values():
        header = _obj_header(pdf, off)
        if re.search(rb"/Type\s*/Page\b", header):
            for m in re.finditer(rb"/Contents\s+(?:(\d+)\s+0\s+R|\[([^\]]*)\])", header):
                refs = (
                    [int(m.group(1))]
                    if m.group(1)
                    else [int(x) for x in re.findall(rb"(\d+)\s+0\s+R", m.group(2))]
                )
                for ref in refs:
                    o = objs.get(ref)
                    if o is not None:
                        content += (_stream_bytes(pdf, o) or b"") + b"\n"
            break
    if not content:
        return []

    runs: list[TextRun] = []
    ctm: Matrix = _IDENTITY
    stack: list[Matrix] = []
    tm: Matrix = _IDENTITY
    tlm: Matrix = _IDENTITY
    leading = 0.0
    font_size = 0.0
    char_space = 0.0
    word_space = 0.0
    h_scale = 1.0
    font: Font | None = None
    operands: list = []
    arrays: list[list] = []

    def push(value) -> None:
        (arrays[-1] if arrays else operands).append(value)

    def nums(count: int) -> list[float] | None:
        vals = [v for v in operands if isinstance(v, float)]
        return vals[-count:] if len(vals) >= count else None

    def advance(dx: float) -> None:
        """Move the text matrix along its own baseline by ``dx`` text units."""
        nonlocal tm
        tm = _mul((1.0, 0.0, 0.0, 1.0, dx, 0.0), tm)

    def show(raw: bytes) -> None:
        text = font.decode(raw) if font else raw.decode("latin-1")
        trm = _mul(tm, ctm)
        scale = (abs(trm[0]) + abs(trm[3])) / 2 or 1.0
        # Walk the glyphs so the run ends exactly where the next one begins.
        width = 0.0
        for code in raw:
            glyph = (font.width(code) if font else 500.0) / 1000.0 * font_size
            width += (glyph + char_space + (word_space if code == 32 else 0.0)) * h_scale
        start_x = trm[4]
        advance(width)
        if text:
            # Whitespace-only runs are kept: they carry the spaces that hold
            # words apart once neighbouring runs are glued back together.
            end = _mul(tm, ctm)
            runs.append(TextRun(start_x, end[4], trm[5], font_size * scale, text))

    def newline(dx: float, dy: float) -> None:
        nonlocal tm, tlm
        tlm = _mul((1.0, 0.0, 0.0, 1.0, dx, dy), tlm)
        tm = tlm

    for kind, value in _lex(content):
        if kind in ("num", "str", "name"):
            push(value)
            continue
        if value == "[":
            arrays.append([])
            continue
        if value == "]":
            done = arrays.pop() if arrays else []
            push(done)
            continue
        op = value
        if op == "q":
            stack.append(ctm)
        elif op == "Q":
            ctm = stack.pop() if stack else _IDENTITY
        elif op == "cm":
            v = nums(6)
            if v:
                ctm = _mul(tuple(v), ctm)  # type: ignore[arg-type]
        elif op == "BT":
            tm = tlm = _IDENTITY
        elif op == "Tf":
            names = [o for o in operands if isinstance(o, str)]
            sizes = [o for o in operands if isinstance(o, float)]
            if names:
                font = fonts.get(names[-1])
            if sizes:
                font_size = sizes[-1]
        elif op == "Tc":
            v = nums(1)
            if v:
                char_space = v[0]
        elif op == "Tw":
            v = nums(1)
            if v:
                word_space = v[0]
        elif op == "Tz":
            v = nums(1)
            if v:
                h_scale = v[0] / 100.0
        elif op == "Tm":
            v = nums(6)
            if v:
                tm = tlm = tuple(v)  # type: ignore[assignment]
        elif op in ("Td", "TD"):
            v = nums(2)
            if v:
                if op == "TD":
                    leading = -v[1]
                newline(v[0], v[1])
        elif op == "TL":
            v = nums(1)
            if v:
                leading = v[0]
        elif op == "T*":
            newline(0.0, -leading)
        elif op == "Tj":
            strs = [o for o in operands if isinstance(o, bytes)]
            if strs:
                show(strs[-1])
        elif op == "TJ":
            for item in next(
                (o for o in reversed(operands) if isinstance(o, list)), []
            ):
                if isinstance(item, bytes):
                    show(item)
                elif isinstance(item, float):
                    # Positive numbers pull the next glyph left (kerning).
                    advance(-item / 1000.0 * font_size * h_scale)
        elif op in ("'", '"'):
            newline(0.0, -leading)
            strs = [o for o in operands if isinstance(o, bytes)]
            if strs:
                show(strs[-1])
        operands = []
        arrays = []

    return runs


def extract_rows(pdf: bytes, tolerance: float = 3.0) -> list[list[str]]:
    """Group text runs into visual rows of cells, top to bottom.

    Runs that sit flush against each other belong to the same table cell - the
    generator emits a fresh run per kerning pair - so they are glued back
    together, and only a real horizontal gap starts a new cell.

    Returns a list of rows, each a list of cell strings ordered left to right.
    """
    runs = extract_runs(pdf)
    rows: list[list[TextRun]] = []
    for run in sorted(runs, key=lambda r: (-r.y, r.x)):
        if rows and abs(rows[-1][0].y - run.y) <= tolerance:
            rows[-1].append(run)
        else:
            rows.append([run])

    out = []
    for row in rows:
        cells: list[str] = []
        prev: TextRun | None = None
        for run in sorted(row, key=lambda r: r.x):
            gap = run.x - prev.x_end if prev else 0.0
            if prev is not None and gap <= max(0.6, 0.25 * run.size):
                cells[-1] += run.text
            else:
                cells.append(run.text)
            prev = run
        cells = [c.strip() for c in cells]
        cells = [c for c in cells if c]
        if cells:
            out.append(cells)
    return out
