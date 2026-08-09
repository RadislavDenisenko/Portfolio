/* Positioned-text extraction from a PDF, with no library behind it.
 *
 * A direct port of pdf_text.py — same algorithm, same output. The invoices use
 * subsetted fonts, so the bytes in the content stream are glyph indices; each
 * font's /ToUnicode CMap turns them back into characters and its /Widths array
 * says how far each one advances, which is what lets neighbouring runs be glued
 * back into table cells.
 *
 * Classic script on purpose: this page has to work when it is double-clicked
 * from the file manager, and ES modules do not load over file://.
 */
(function (global) {
  'use strict';

  var IDENTITY = [1, 0, 0, 1, 0, 0];

  function latin1(bytes) {
    var out = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return out;
  }

  function bytesFrom(text) {
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }

  async function inflateOnce(bytes, format) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* Try the declared length first, then a trimmed slice, then raw deflate.
   * DecompressionStream rejects trailing bytes that zlib itself tolerates. */
  async function inflate(candidates) {
    for (var i = 0; i < candidates.length; i++) {
      for (var f = 0; f < 2; f++) {
        try {
          return await inflateOnce(candidates[i], f === 0 ? 'deflate' : 'deflate-raw');
        } catch (err) {
          /* try the next candidate */
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------- objects

  function indexObjects(text) {
    var objs = {};
    var re = /(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b/g;
    var m;
    while ((m = re.exec(text))) objs[parseInt(m[1], 10)] = m.index + m[0].length;
    return objs;
  }

  function objHeader(text, off) {
    var stream = text.indexOf('stream', off);
    var end = text.indexOf('endobj', off);
    if (end < 0) end = text.length;
    if (stream >= 0 && stream < end) return text.slice(off, stream);
    return text.slice(off, end);
  }

  async function streamBytes(text, bytes, off) {
    var m = /stream(\r\n|\n|\r)/.exec(text.slice(off, off + 4096));
    if (!m) return null;
    var start = off + m.index + m[0].length;
    var header = text.slice(off, off + m.index);
    var end = text.indexOf('endstream', start);
    if (end < 0) end = bytes.length;

    var candidates = [];
    var declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(header);
    if (declared) candidates.push(bytes.subarray(start, start + parseInt(declared[1], 10)));
    var stop = end;
    while (stop > start && (bytes[stop - 1] === 10 || bytes[stop - 1] === 13)) stop--;
    candidates.push(bytes.subarray(start, stop));
    candidates.push(bytes.subarray(start, end));

    if (header.indexOf('/FlateDecode') >= 0) return inflate(candidates);
    return candidates[candidates.length - 1];
  }

  // ---------------------------------------------------------- ToUnicode

  function utf16be(hex) {
    var out = '';
    for (var i = 0; i + 3 < hex.length + 1; i += 4) {
      var unit = parseInt(hex.slice(i, i + 4), 16);
      if (!isNaN(unit)) out += String.fromCharCode(unit);
    }
    return out;
  }

  function utf16bePlus(hex, delta) {
    var units = [];
    for (var i = 0; i < hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16));
    if (!units.length || isNaN(units[units.length - 1])) return '';
    units[units.length - 1] += delta;
    return units.map(function (u) { return String.fromCharCode(u); }).join('');
  }

  function parseCMap(text) {
    var cmap = {};
    var block;

    var charBlocks = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((block = charBlocks.exec(text))) {
      var pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
      var p;
      while ((p = pair.exec(block[1]))) cmap[parseInt(p[1], 16)] = utf16be(p[2]);
    }

    var rangeBlocks = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((block = rangeBlocks.exec(text))) {
      var range = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g;
      var r;
      while ((r = range.exec(block[1]))) {
        var lo = parseInt(r[1], 16);
        var hi = parseInt(r[2], 16);
        if (hi < lo || hi - lo > 0xffff) continue;
        if (r[3] !== undefined) {
          for (var step = 0; lo + step <= hi; step++) cmap[lo + step] = utf16bePlus(r[3], step);
        } else {
          var one = /<([0-9A-Fa-f]+)>/g;
          var o;
          var i = 0;
          while ((o = one.exec(r[4]))) cmap[lo + i++] = utf16be(o[1]);
        }
      }
    }
    return cmap;
  }

  function parseWidths(header) {
    var first = /\/FirstChar\s+(\d+)/.exec(header);
    var arr = /\/Widths\s*\[([\s\S]*?)\]/.exec(header);
    var widths = {};
    if (!first || !arr) return widths;
    var start = parseInt(first[1], 10);
    var values = arr[1].match(/[-+]?\d+\.?\d*/g) || [];
    for (var i = 0; i < values.length; i++) widths[start + i] = parseFloat(values[i]);
    return widths;
  }

  // ------------------------------------------------------------- lexing

  function lexString(text, i) {
    i++;
    var depth = 1;
    var out = '';
    while (i < text.length) {
      var c = text.charCodeAt(i);
      if (c === 0x5c) {
        i++;
        var e = text.charCodeAt(i);
        var simple = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (simple[e] !== undefined) {
          out += String.fromCharCode(simple[e]);
          i++;
        } else if (e >= 0x30 && e <= 0x37) {
          var digits = '';
          while (i < text.length && digits.length < 3) {
            var d = text.charCodeAt(i);
            if (d < 0x30 || d > 0x37) break;
            digits += text[i];
            i++;
          }
          out += String.fromCharCode(parseInt(digits, 8) & 0xff);
        } else if (e === 0x0a) {
          i++;
        } else {
          out += text[i];
          i++;
        }
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29) {
        depth--;
        if (depth === 0) return [out, i + 1];
      }
      out += text[i];
      i++;
    }
    return [out, i];
  }

  var NAME_RE = /^\/([^\s/[\]<>(){}%]*)/;
  var NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)/;
  var OP_RE = /^[^\s/[\]<>(){}%]+/;

  function lex(text, emit) {
    var i = 0;
    while (i < text.length) {
      var c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\0') {
        i++;
      } else if (c === '%') {
        var nl = text.indexOf('\n', i);
        i = nl < 0 ? text.length : nl + 1;
      } else if (c === '(') {
        var res = lexString(text, i);
        emit('str', res[0]);
        i = res[1];
      } else if (text.substr(i, 2) === '<<') {
        emit('op', '<<');
        i += 2;
      } else if (text.substr(i, 2) === '>>') {
        emit('op', '>>');
        i += 2;
      } else if (c === '<') {
        var close = text.indexOf('>', i);
        if (close < 0) break;
        var hex = text.slice(i + 1, close).replace(/\s/g, '');
        if (hex.length % 2) hex += '0';
        var out = '';
        for (var h = 0; h < hex.length; h += 2) {
          out += String.fromCharCode(parseInt(hex.substr(h, 2), 16));
        }
        emit('str', out);
        i = close + 1;
      } else if (c === '/') {
        var nm = NAME_RE.exec(text.slice(i));
        emit('name', nm[1]);
        i += nm[0].length;
      } else if (c === '[' || c === ']') {
        emit('op', c);
        i++;
      } else {
        var num = NUM_RE.exec(text.slice(i, i + 32));
        if (num) {
          emit('num', parseFloat(num[0]));
          i += num[0].length;
          continue;
        }
        var op = OP_RE.exec(text.slice(i, i + 64));
        if (op) {
          emit('op', op[0]);
          i += op[0].length;
        } else {
          i++;
        }
      }
    }
  }

  function mul(m, n) {
    return [
      m[0] * n[0] + m[1] * n[2],
      m[0] * n[1] + m[1] * n[3],
      m[2] * n[0] + m[3] * n[2],
      m[2] * n[1] + m[3] * n[3],
      m[4] * n[0] + m[5] * n[2] + n[4],
      m[4] * n[1] + m[5] * n[3] + n[5]
    ];
  }

  // -------------------------------------------------------------- runs

  async function extractRuns(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot decompress PDF streams. Try Chrome, Edge, Firefox or Safari 16.4+.');
    }
    var text = latin1(bytes);
    var objs = indexObjects(text);

    var resources = '';
    var pageOff = null;
    for (var key in objs) {
      var header = objHeader(text, objs[key]);
      if (/\/Type\s*\/Page\b/.test(header)) {
        pageOff = objs[key];
        var ref = /\/Resources\s+(\d+)\s+0\s+R/.exec(header);
        if (ref) {
          resources = objHeader(text, objs[parseInt(ref[1], 10)]);
        } else {
          var inline = /\/Resources\s*(<<[\s\S]*)/.exec(header);
          resources = inline ? inline[1] : '';
        }
        break;
      }
    }
    if (pageOff === null) return [];

    var fonts = {};
    var fm = /\/Font\s*<<([\s\S]*?)>>/.exec(resources);
    if (fm) {
      var entry = /\/([^\s/]+)\s+(\d+)\s+0\s+R/g;
      var e;
      while ((e = entry.exec(fm[1]))) {
        var fHeader = objHeader(text, objs[parseInt(e[2], 10)]);
        var cmap = {};
        var tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(fHeader);
        if (tu) {
          var data = await streamBytes(text, bytes, objs[parseInt(tu[1], 10)]);
          if (data) cmap = parseCMap(latin1(data));
        }
        fonts[e[1]] = { cmap: cmap, widths: parseWidths(fHeader) };
      }
    }

    var pageHeader = objHeader(text, pageOff);
    var content = '';
    var cm = /\/Contents\s+(?:(\d+)\s+0\s+R|\[([^\]]*)\])/g;
    var cMatch;
    while ((cMatch = cm.exec(pageHeader))) {
      var refs = cMatch[1]
        ? [parseInt(cMatch[1], 10)]
        : (cMatch[2].match(/(\d+)\s+0\s+R/g) || []).map(function (s) { return parseInt(s, 10); });
      for (var r = 0; r < refs.length; r++) {
        if (objs[refs[r]] === undefined) continue;
        var chunk = await streamBytes(text, bytes, objs[refs[r]]);
        if (chunk) content += latin1(chunk) + '\n';
      }
    }
    if (!content) return [];

    var runs = [];
    var ctm = IDENTITY;
    var stack = [];
    var tm = IDENTITY;
    var tlm = IDENTITY;
    var leading = 0;
    var fontSize = 0;
    var charSpace = 0;
    var wordSpace = 0;
    var hScale = 1;
    var font = null;
    var operands = [];
    var arrays = [];

    function push(value) {
      (arrays.length ? arrays[arrays.length - 1] : operands).push(value);
    }

    function nums(count) {
      var vals = operands.filter(function (v) { return typeof v === 'number'; });
      return vals.length >= count ? vals.slice(vals.length - count) : null;
    }

    function advance(dx) {
      tm = mul([1, 0, 0, 1, dx, 0], tm);
    }

    function show(raw) {
      var out = '';
      var width = 0;
      for (var i = 0; i < raw.length; i++) {
        var code = raw.charCodeAt(i) & 0xff;
        out += font && font.cmap && Object.keys(font.cmap).length
          ? (font.cmap[code] !== undefined ? font.cmap[code] : '')
          : String.fromCharCode(code);
        var w = font && font.widths[code] !== undefined ? font.widths[code] : 500;
        width += (w / 1000 * fontSize + charSpace + (code === 32 ? wordSpace : 0)) * hScale;
      }
      var trm = mul(tm, ctm);
      var scale = (Math.abs(trm[0]) + Math.abs(trm[3])) / 2 || 1;
      var startX = trm[4];
      advance(width);
      if (out) {
        var end = mul(tm, ctm);
        runs.push({ x: startX, xEnd: end[4], y: trm[5], size: fontSize * scale, text: out });
      }
    }

    function newline(dx, dy) {
      tlm = mul([1, 0, 0, 1, dx, dy], tlm);
      tm = tlm;
    }

    lex(content, function (kind, value) {
      if (kind === 'num' || kind === 'str' || kind === 'name') {
        push(kind === 'str' ? { s: value } : value);
        return;
      }
      if (value === '[') { arrays.push([]); return; }
      if (value === ']') { push(arrays.pop() || []); return; }

      var op = value;
      var v;
      if (op === 'q') stack.push(ctm);
      else if (op === 'Q') ctm = stack.pop() || IDENTITY;
      else if (op === 'cm') { v = nums(6); if (v) ctm = mul(v, ctm); }
      else if (op === 'BT') { tm = tlm = IDENTITY; }
      else if (op === 'Tf') {
        var names = operands.filter(function (o) { return typeof o === 'string'; });
        var sizes = operands.filter(function (o) { return typeof o === 'number'; });
        if (names.length) font = fonts[names[names.length - 1]] || null;
        if (sizes.length) fontSize = sizes[sizes.length - 1];
      }
      else if (op === 'Tc') { v = nums(1); if (v) charSpace = v[0]; }
      else if (op === 'Tw') { v = nums(1); if (v) wordSpace = v[0]; }
      else if (op === 'Tz') { v = nums(1); if (v) hScale = v[0] / 100; }
      else if (op === 'Tm') { v = nums(6); if (v) { tm = v.slice(); tlm = v.slice(); } }
      else if (op === 'Td' || op === 'TD') {
        v = nums(2);
        if (v) { if (op === 'TD') leading = -v[1]; newline(v[0], v[1]); }
      }
      else if (op === 'TL') { v = nums(1); if (v) leading = v[0]; }
      else if (op === 'T*') newline(0, -leading);
      else if (op === 'Tj') {
        var s = operands.filter(function (o) { return o && o.s !== undefined; });
        if (s.length) show(s[s.length - 1].s);
      }
      else if (op === 'TJ') {
        var arr = null;
        for (var i = operands.length - 1; i >= 0; i--) {
          if (Array.isArray(operands[i])) { arr = operands[i]; break; }
        }
        (arr || []).forEach(function (item) {
          if (item && item.s !== undefined) show(item.s);
          else if (typeof item === 'number') advance(-item / 1000 * fontSize * hScale);
        });
      }
      else if (op === "'" || op === '"') {
        newline(0, -leading);
        var q = operands.filter(function (o) { return o && o.s !== undefined; });
        if (q.length) show(q[q.length - 1].s);
      }
      operands = [];
      arrays = [];
    });

    return runs;
  }

  /* Group runs into visual rows of cells, top to bottom, left to right. */
  async function extractRows(bytes, tolerance) {
    tolerance = tolerance || 3;
    var runs = await extractRuns(bytes);
    runs.sort(function (a, b) { return b.y - a.y || a.x - b.x; });

    var rows = [];
    runs.forEach(function (run) {
      var last = rows[rows.length - 1];
      if (last && Math.abs(last[0].y - run.y) <= tolerance) last.push(run);
      else rows.push([run]);
    });

    return rows.map(function (row) {
      row.sort(function (a, b) { return a.x - b.x; });
      var cells = [];
      var prev = null;
      row.forEach(function (run) {
        var gap = prev ? run.x - prev.xEnd : 0;
        if (prev && gap <= Math.max(0.6, 0.25 * run.size)) cells[cells.length - 1] += run.text;
        else cells.push(run.text);
        prev = run;
      });
      return cells.map(function (c) { return c.trim(); }).filter(Boolean);
    }).filter(function (row) { return row.length; });
  }

  global.PdfExtract = { extractRows: extractRows, extractRuns: extractRuns, bytesFrom: bytesFrom };
})(window);
