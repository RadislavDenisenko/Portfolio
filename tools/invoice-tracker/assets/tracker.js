/* Invoice tracker — reads the pay lines, does the arithmetic, draws the page.
 *
 * The invoice semantics here mirror invoice_parser.py exactly: several pay
 * lines can share one JOB number, and those are one job, not several. Money is
 * kept in whole cents until the moment it is printed.
 */
(function () {
  'use strict';

  var STORE_KEY = 'invoice-tracker:v1';
  var MONTHS = {};
  ('january february march april may june july august september october november december')
    .split(' ')
    .forEach(function (name, i) { MONTHS[name] = i + 1; });

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MONEY_RE = /^-?\$-?[\d,]+\.\d{2}$|^\(\$[\d,]+\.\d{2}\)$/;

  // ------------------------------------------------------------- money

  function moneyToCents(text) {
    text = String(text).trim();
    var negative = text.charAt(0) === '-' || text.indexOf('$-') >= 0 || text.charAt(0) === '(';
    var digits = text.replace(/[^\d]/g, '');
    if (!digits) return 0;
    var cents = parseInt(digits, 10);
    return negative ? -cents : cents;
  }

  function money(cents, withCents) {
    var sign = cents < 0 ? '-' : '';
    var abs = Math.abs(cents);
    if (withCents === false) {
      return sign + '$' + Math.round(abs / 100).toLocaleString('en-US');
    }
    var whole = Math.floor(abs / 100).toLocaleString('en-US');
    return sign + '$' + whole + '.' + String(abs % 100).padStart(2, '0');
  }

  // ------------------------------------------------------------ parsing

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  function parsePeriod(text) {
    text = String(text || '').replace(/[–—]/g, '-').trim();
    var m = /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*(\d{1,2}),\s*(\d{4})$/.exec(text);
    if (m && MONTHS[m[1].toLowerCase()]) {
      var mo = MONTHS[m[1].toLowerCase()];
      return [iso(+m[4], mo, +m[2]), iso(+m[4], mo, +m[3])];
    }
    m = /^([A-Za-z]+)\s+(\d{1,2})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text);
    if (m && MONTHS[m[1].toLowerCase()] && MONTHS[m[3].toLowerCase()]) {
      var m1 = MONTHS[m[1].toLowerCase()], m2 = MONTHS[m[3].toLowerCase()], y = +m[5];
      return [iso(m1 > m2 ? y - 1 : y, m1, +m[2]), iso(y, m2, +m[4])];
    }
    m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*-\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text);
    if (m && MONTHS[m[1].toLowerCase()] && MONTHS[m[4].toLowerCase()]) {
      return [iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]),
              iso(+m[6], MONTHS[m[4].toLowerCase()], +m[5])];
    }
    return [null, null];
  }

  function parseInvoice(rows, source) {
    var lineItems = [];
    var adjustments = [];
    var printed = {};
    var techId = '', name = '', payPeriod = '';

    rows.forEach(function (row, i) {
      var joined = row.join(' ').toUpperCase();
      if (joined.indexOf('TECH') >= 0 && joined.indexOf('PAY PERIOD') >= 0 && rows[i + 1]) {
        var values = rows[i + 1];
        if (values.length >= 3) {
          techId = values[0]; name = values[1]; payPeriod = values[2];
        }
        return;
      }
      if (row.length === 4 && DATE_RE.test(row[0]) && MONEY_RE.test(row[3])) {
        lineItems.push({ date: row[0], code: row[1], job: row[2], cents: moneyToCents(row[3]) });
        return;
      }
      if (row.length >= 2 && MONEY_RE.test(row[row.length - 1])) {
        var label = row.slice(0, -1).join(' ').trim();
        var cents = moneyToCents(row[row.length - 1]);
        var key = label.toUpperCase();
        if (key === 'TOTAL JOBS' || key === 'TOTAL PAY' || key === 'SUBTOTAL' || key === 'TOTAL') {
          printed[key] = cents;
        } else {
          adjustments.push({ label: label, cents: cents });
        }
      }
    });

    var period = parsePeriod(payPeriod);
    var start = period[0], end = period[1];
    if (!start && lineItems.length) {
      var dates = lineItems.map(function (l) { return l.date; }).sort();
      var last = new Date(dates[dates.length - 1] + 'T00:00:00');
      // Fall back to the Sunday-Saturday week the work landed in.
      var endDate = new Date(last);
      endDate.setDate(last.getDate() + ((6 - last.getDay()) % 7));
      var startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 6);
      start = startDate.toISOString().slice(0, 10);
      end = endDate.toISOString().slice(0, 10);
    }

    return {
      techId: techId, name: name, payPeriod: payPeriod,
      periodStart: start, periodEnd: end, source: source || '',
      lineItems: lineItems, adjustments: adjustments, printed: printed
    };
  }

  // ---------------------------------------------------------- analytics

  function analyze(invoice) {
    var byDate = {};
    invoice.lineItems.forEach(function (item) {
      var day = byDate[item.date] || (byDate[item.date] = { jobs: {}, lines: 0, cents: 0 });
      day.jobs[item.job] = (day.jobs[item.job] || 0) + item.cents;
      day.lines += 1;
      day.cents += item.cents;
    });

    var days = Object.keys(byDate).sort().map(function (date) {
      var day = byDate[date];
      var jobs = Object.keys(day.jobs).length;
      return {
        date: date,
        weekday: new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
        jobs: jobs,
        lines: day.lines,
        cents: day.cents,
        centsPerJob: jobs ? Math.round(day.cents / jobs) : 0
      };
    });

    var gross = days.reduce(function (a, d) { return a + d.cents; }, 0);
    var jobs = days.reduce(function (a, d) { return a + d.jobs; }, 0);
    var fees = invoice.adjustments.reduce(function (a, x) { return a + x.cents; }, 0);
    var printedGross = invoice.printed['TOTAL JOBS'];

    return {
      days: days,
      daysWorked: days.length,
      jobs: jobs,
      lines: days.reduce(function (a, d) { return a + d.lines; }, 0),
      grossCents: gross,
      feesCents: fees,
      netCents: gross + fees,
      printedGrossCents: printedGross === undefined ? null : printedGross,
      printedNetCents: invoice.printed['TOTAL PAY'] === undefined ? null : invoice.printed['TOTAL PAY'],
      discrepancyCents: printedGross === undefined ? 0 : gross - printedGross,
      centsPerJob: jobs ? Math.round(gross / jobs) : 0,
      jobsPerDay: days.length ? jobs / days.length : 0,
      centsPerDay: days.length ? Math.round(gross / days.length) : 0
    };
  }

  /* How many jobs a day clears `targetCents` of take-home in a week. */
  function jobsNeeded(targetCents, days, centsPerJob, feesCents) {
    if (days <= 0 || centsPerJob <= 0) {
      return { perDay: 0, perWeek: 0, centsPerDay: 0 };
    }
    var grossNeeded = targetCents - (feesCents || 0);
    var perWeek = grossNeeded / centsPerJob;
    return {
      perDay: perWeek / days,
      perWeek: perWeek,
      centsPerDay: Math.round(grossNeeded / days)
    };
  }

  // -------------------------------------------------------------- store

  var state = { invoices: [], selected: 'all', target: 130000, days: 5 };

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (raw.invoices) state.invoices = raw.invoices;
      if (raw.target) state.target = raw.target;
      if (raw.days) state.days = raw.days;
    } catch (err) { /* first run */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        invoices: state.invoices, target: state.target, days: state.days
      }));
    } catch (err) {
      note('Could not save to this browser’s storage.', true);
    }
  }

  function addInvoice(invoice) {
    if (!invoice.lineItems.length) return false;
    var i = state.invoices.findIndex(function (x) { return x.periodEnd === invoice.periodEnd; });
    if (i >= 0) state.invoices[i] = invoice;
    else state.invoices.push(invoice);
    state.invoices.sort(function (a, b) { return (b.periodEnd || '').localeCompare(a.periodEnd || ''); });
    return true;
  }

  // ------------------------------------------------------------- render

  function el(id) { return document.getElementById(id); }

  function note(message, isError) {
    var box = el('note');
    box.textContent = message;
    box.className = 'note' + (isError ? ' note-error' : '') + (message ? ' is-on' : '');
  }

  /* Combine several weeks into one set of averages. */
  function combined(invoices) {
    var all = { lineItems: [], adjustments: [], printed: {} };
    invoices.forEach(function (inv) {
      all.lineItems = all.lineItems.concat(inv.lineItems);
      all.adjustments = all.adjustments.concat(inv.adjustments);
    });
    var stats = analyze(all);
    stats.weeks = invoices.length;
    stats.feesPerWeek = invoices.length ? Math.round(stats.feesCents / invoices.length) : 0;
    stats.daysPerWeek = invoices.length ? stats.daysWorked / invoices.length : 0;
    stats.netPerWeek = invoices.length ? Math.round(stats.netCents / invoices.length) : 0;
    return stats;
  }

  function statTile(label, value, sub) {
    return '<div class="tile"><div class="tile-label">' + label + '</div>' +
      '<div class="tile-value">' + value + '</div>' +
      (sub ? '<div class="tile-sub">' + sub + '</div>' : '') + '</div>';
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function renderWeekPicker() {
    var picker = el('week-picker');
    var html = '<button class="chip' + (state.selected === 'all' ? ' is-on' : '') +
      '" data-week="all">All ' + plural(state.invoices.length, 'week') + '</button>';
    state.invoices.forEach(function (inv) {
      html += '<button class="chip' + (state.selected === inv.periodEnd ? ' is-on' : '') +
        '" data-week="' + inv.periodEnd + '">' + (inv.payPeriod || inv.periodEnd) + '</button>';
    });
    picker.innerHTML = html;
    Array.prototype.forEach.call(picker.querySelectorAll('.chip'), function (chip) {
      chip.addEventListener('click', function () {
        state.selected = chip.getAttribute('data-week');
        render();
      });
    });
  }

  /* Per-day pay bars. One series, so no legend — the heading names it. */
  function renderDays(stats) {
    if (!stats.days.length) { el('days').innerHTML = ''; return; }
    var peak = Math.max.apply(null, stats.days.map(function (d) { return d.cents; }));
    var target = Math.round(state.target / state.days);
    var scale = Math.max(peak, target) || 1;

    var html = '<table class="grid"><caption>What each day paid' +
      ' <span class="caption-note">dashed line = ' + money(target, false) +
      '/day, the pace for ' + money(state.target, false) + ' over ' +
      plural(state.days, 'day') + '</span>' +
      '</caption><thead><tr><th>Day</th><th class="num">Jobs</th>' +
      '<th class="num">Lines</th><th class="num">Paid</th><th class="num">Per job</th>' +
      '<th class="bar-col"></th></tr></thead><tbody>';

    stats.days.forEach(function (day) {
      var width = (day.cents / scale) * 100;
      var mark = target ? (target / scale) * 100 : 0;
      html += '<tr tabindex="0" data-tip="' + day.date + ' · ' + day.jobs + ' jobs · ' +
        day.lines + ' pay lines · ' + money(day.cents) + '">' +
        '<td><span class="day-name">' + day.weekday + '</span> ' +
        '<span class="day-date">' + day.date.slice(5) + '</span></td>' +
        '<td class="num strong">' + day.jobs + '</td>' +
        '<td class="num soft">' + day.lines + '</td>' +
        '<td class="num">' + money(day.cents) + '</td>' +
        '<td class="num soft">' + money(day.centsPerJob) + '</td>' +
        '<td class="bar-col"><span class="bar-track">' +
        '<span class="bar" style="width:' + width.toFixed(1) + '%"></span>' +
        (mark ? '<span class="bar-mark" style="left:' + mark.toFixed(1) + '%"></span>' : '') +
        '</span></td></tr>';
    });
    html += '</tbody></table>';
    el('days').innerHTML = html;
  }

  function renderHistory() {
    if (state.invoices.length < 2) { el('history').innerHTML = ''; return; }
    var weeks = state.invoices.slice().reverse().map(function (inv) {
      var s = analyze(inv);
      return { label: inv.payPeriod || inv.periodEnd, end: inv.periodEnd, stats: s };
    });
    var peak = Math.max.apply(null, weeks.map(function (w) { return w.stats.netCents; }));
    var html = '<table class="grid"><caption>Every week you have loaded</caption>' +
      '<thead><tr><th>Week</th><th class="num">Days</th><th class="num">Jobs</th>' +
      '<th class="num">Jobs/day</th><th class="num">Per job</th><th class="num">Take home</th>' +
      '<th class="bar-col"></th></tr></thead><tbody>';
    weeks.forEach(function (w) {
      var s = w.stats;
      var hit = s.netCents >= state.target;
      html += '<tr tabindex="0" data-tip="' + w.label + ' · ' + s.daysWorked + ' days · ' +
        s.jobs + ' jobs · ' + money(s.netCents) + '">' +
        '<td>' + w.label + '</td>' +
        '<td class="num soft">' + s.daysWorked + '</td>' +
        '<td class="num strong">' + s.jobs + '</td>' +
        '<td class="num">' + s.jobsPerDay.toFixed(1) + '</td>' +
        '<td class="num soft">' + money(s.centsPerJob) + '</td>' +
        '<td class="num">' + money(s.netCents) + '</td>' +
        '<td class="bar-col"><span class="bar-track"><span class="bar' +
        (hit ? ' bar-hit' : '') + '" style="width:' +
        ((s.netCents / (peak || 1)) * 100).toFixed(1) + '%"></span>' +
        '<span class="bar-mark" style="left:' +
        ((state.target / (peak || 1)) * 100).toFixed(1) + '%"></span></span></td></tr>';
    });
    html += '</tbody></table>';
    el('history').innerHTML = html;
  }

  function renderTarget(basis) {
    var need = jobsNeeded(state.target, state.days, basis.centsPerJob, basis.feesPerWeek || 0);
    el('target-answer').innerHTML =
      '<div class="answer-number">' + need.perDay.toFixed(1) + '</div>' +
      '<div class="answer-unit">jobs a day</div>';
    el('target-detail').innerHTML =
      '<p>To take home <strong>' + money(state.target, false) + '</strong> a week over <strong>' +
      plural(state.days, 'day') + '</strong>, at your average of <strong>' +
      money(basis.centsPerJob) + ' a job</strong>, you need to average <strong>' +
      need.perDay.toFixed(1) + ' jobs a day</strong> — ' +
      Math.ceil(need.perWeek) + ' jobs across the week, about ' +
      money(need.centsPerDay) + ' a day.</p>' +
      (basis.jobsPerDay
        ? '<p class="' + (basis.jobsPerDay >= need.perDay ? 'good' : 'short') + '">You currently average ' +
          basis.jobsPerDay.toFixed(1) + ' jobs a day, which is ' +
          (basis.jobsPerDay >= need.perDay
            ? 'above that pace by ' + (basis.jobsPerDay - need.perDay).toFixed(1) + ' jobs a day.'
            : 'short by ' + (need.perDay - basis.jobsPerDay).toFixed(1) + ' jobs a day.') + '</p>'
        : '');
  }

  /* When the next invoice is due: they land on Thursdays. */
  function renderStatus() {
    var box = el('status');
    if (!state.invoices.length) { box.textContent = ''; return; }
    var now = new Date();
    var next = new Date(now);
    next.setDate(now.getDate() + ((4 - now.getDay() + 7) % 7 || 7));
    var latest = state.invoices[0];
    box.innerHTML = 'Latest loaded: <strong>' + (latest.payPeriod || latest.periodEnd) +
      '</strong> · next invoice email expected <strong>' +
      next.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) +
      '</strong>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // Everything below is DISPLAY only. The arithmetic happens once, in tax.py,
  // and arrives as data/tax-summary.json. Recomputing any of it here would mean
  // two copies of the tax code that can silently disagree about what he owes.
  function renderTax(tax) {
    var box = el('tax');
    var missing = el('tax-missing');
    if (!tax) { box.hidden = true; missing.hidden = false; return; }
    missing.hidden = true;
    box.hidden = false;

    // Tax data can exist before any PDF has been dropped in this browser.
    if (!state.invoices.length) { el('dashboard').hidden = false; el('empty').hidden = true; }

    var est = tax.estimate || {};
    var sh = tax.safe_harbor;
    var inc = tax.income || {};

    el('tax-when').textContent = 'Worked out ' + (tax.generated || '').replace('T', ' at ') +
      ' from ' + plural(inc.weeks || 0, 'week') + ' of invoices.';

    var tiles = statTile(
      'Put aside each week',
      money(tax.set_aside_per_week_cents, true),
      'for the ' + plural(tax.weeks_until_due, 'week') + ' until April 15'
    );
    tiles += statTile('Tax for ' + tax.year, money(est.total_tax_cents, true),
      est.withheld_cents ? money(est.withheld_cents, true) + ' already withheld' : 'nothing withheld');
    tiles += statTile('Left to find', money(est.still_owed_cents, true), 'by April 15');
    if (sh) {
      tiles += statTile('Pay by Sept 15', money(sh.pay_by_sept_15_cents, true),
        sh.pay_by_sept_15_cents ? 'stops the late-payment interest' : 'already covered');
    }
    tiles += statTile('Deductions', money((tax.deductions || {}).total_cents, true),
      'off your taxable income');
    el('tax-tiles').innerHTML = tiles;

    var d = tax.deductions || {};
    var rows = Object.keys(d.by_category || {}).map(function (k) { return d.by_category[k]; })
      .sort(function (a, b) { return b.cents - a.cents; })
      .map(function (c) {
        return '<div class="tax-row' + (c.excluded ? ' is-out' : '') + '">' +
          '<span>' + esc(c.label) + '<em class="soft"> x' + c.count + '</em></span>' +
          '<span class="num">' + money(c.cents, true) +
          (c.excluded ? ' <em class="soft">(covered by mileage)</em>' : '') + '</span></div>';
      }).join('');
    if (d.miles) {
      rows += '<div class="tax-row"><span>' + d.miles.toLocaleString() +
        ' business miles</span><span class="num">' + money(d.mileage_cents, true) + '</span></div>';
    }
    el('tax-deductions').innerHTML = rows ||
      '<p class="soft">Nothing recorded yet. Photograph a receipt and email it to ' +
      'yourself with the subject RCPT.</p>';

    var todo = [];
    if (tax.unreviewed) {
      todo.push(plural(tax.unreviewed, 'scanned item') + ' still need a quick look — ' +
        'run <code>python receipts.py queue</code>.');
    }
    Object.keys(tax.receipts || {}).forEach(function (status) {
      if (status === 'needs extraction') {
        todo.push(plural(tax.receipts[status], 'receipt photo') + ' waiting to be read. ' +
          'Ask Claude: "read my new receipts".');
      } else if (status === 'needs a look') {
        todo.push(plural(tax.receipts[status], 'receipt') + " didn't add up and needs your eyes.");
      }
    });
    (tax.mileage_problems || []).forEach(function (p) { todo.push(esc(p)); });
    var miss = tax.missing_mileage_days || [];
    if (miss.length) {
      todo.push(plural(miss.length, 'day') + ' you worked with no odometer reading, so ' +
        'those miles cannot be claimed: ' + esc(miss.slice(0, 6).join(', ')) +
        (miss.length > 6 ? '…' : ''));
    }
    if (!d.miles && !tax.owns_vehicle) {
      todo.push('Company van: no mileage to claim, but the gas YOU pay for it ' +
        'is deductible — photograph every fill-up (double-tap, shoot, done). ' +
        'The day you buy your own van, tell Claude and mileage switches on.');
    } else if (!d.miles) {
      todo.push('No mileage logged yet. Email yourself the odometer twice a day ' +
        'with the subject MILES — leaving, and getting home.');
    }
    el('tax-todo').innerHTML = todo.length
      ? '<ul class="tax-todo">' + todo.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'
      : '<p class="soft">Nothing needs you right now.</p>';
  }

  function loadTax() {
    // file:// has no fetch; open-tracker.bat serves over localhost, which does.
    if (!window.fetch || location.protocol === 'file:') { renderTax(null); return; }
    fetch('data/tax-summary.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(renderTax)
      .catch(function () { renderTax(null); });
  }

  function render() {
    var hasData = state.invoices.length > 0;
    el('empty').hidden = hasData;
    el('dashboard').hidden = !hasData;
    if (!hasData) { note(''); return; }

    renderWeekPicker();
    renderStatus();

    var isAll = state.selected === 'all';
    var chosen = isAll
      ? state.invoices
      : state.invoices.filter(function (i) { return i.periodEnd === state.selected; });
    if (!chosen.length) { chosen = state.invoices; isAll = true; state.selected = 'all'; }

    var stats = isAll ? combined(chosen) : analyze(chosen[0]);
    if (!isAll) {
      stats.weeks = 1;
      stats.feesPerWeek = stats.feesCents;
      stats.netPerWeek = stats.netCents;
      stats.daysPerWeek = stats.daysWorked;
    }

    var title = isAll && state.invoices.length > 1
      ? plural(state.invoices.length, 'week') + ' · ' +
        state.invoices[state.invoices.length - 1].periodStart + ' to ' + state.invoices[0].periodEnd
      : (chosen[0].payPeriod || chosen[0].periodEnd);
    el('week-title').textContent = title;

    el('tiles').innerHTML =
      statTile('Days worked', stats.daysWorked,
        isAll ? stats.daysPerWeek.toFixed(1) + ' a week' : 'this week') +
      statTile('Jobs', stats.jobs, stats.lines + ' pay lines') +
      statTile('Jobs a day', stats.jobsPerDay.toFixed(1), 'average') +
      statTile('Per job', money(stats.centsPerJob), 'average') +
      statTile('Per day', money(stats.centsPerDay), 'average') +
      statTile(isAll ? 'Take home a week' : 'Take home', money(stats.netPerWeek),
        stats.feesCents ? money(stats.feesCents) + ' in fees' : '');

    renderDays(stats);
    renderHistory();
    renderTarget(stats);

    var warnings = [];
    state.invoices.forEach(function (inv) {
      var s = analyze(inv);
      if (s.discrepancyCents) {
        warnings.push((inv.payPeriod || inv.periodEnd) + ': the ' + s.lines +
          ' pay lines add up to ' + money(s.grossCents) + ', but the invoice prints ' +
          money(s.printedGrossCents) + ' — ' + money(Math.abs(s.discrepancyCents)) +
          (s.discrepancyCents > 0 ? ' short.' : ' over.'));
      }
    });
    el('warnings').innerHTML = warnings.length
      ? '<h2>Worth asking about</h2><ul>' + warnings.map(function (w) {
          return '<li>' + w + '</li>';
        }).join('') + '</ul>'
      : '';
  }

  // -------------------------------------------------------------- input

  async function ingest(files) {
    var added = 0, failed = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      try {
        var bytes = new Uint8Array(await file.arrayBuffer());
        var rows = await PdfExtract.extractRows(bytes);
        var invoice = parseInvoice(rows, file.name);
        if (addInvoice(invoice)) added++;
        else failed.push(file.name + ' (no pay lines found)');
      } catch (err) {
        failed.push(file.name + ' (' + err.message + ')');
      }
    }
    if (added) { save(); render(); }
    note(
      (added ? 'Loaded ' + added + ' invoice' + (added === 1 ? '' : 's') + '. ' : '') +
      (failed.length ? 'Could not read: ' + failed.join(', ') : ''),
      !added && failed.length > 0
    );
  }

  function wireInput() {
    var drop = el('drop');
    var input = el('file');

    drop.addEventListener('click', function () { input.click(); });
    drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () {
      if (input.files.length) ingest(input.files);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        e.preventDefault();
        drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        e.preventDefault();
        if (type === 'drop' || e.target === drop) drop.classList.remove('is-over');
      });
    });
    document.addEventListener('drop', function (e) {
      var files = Array.prototype.filter.call(e.dataTransfer.files, function (f) {
        return /\.pdf$/i.test(f.name);
      });
      if (files.length) ingest(files);
    });
  }

  function wireControls() {
    var amount = el('target-amount');
    var slider = el('target-slider');
    amount.value = Math.round(state.target / 100);
    slider.value = Math.round(state.target / 100);

    function setTarget(dollars) {
      state.target = Math.max(0, Math.round(dollars)) * 100;
      amount.value = Math.round(state.target / 100);
      slider.value = Math.min(3000, Math.round(state.target / 100));
      save();
      render();
    }
    amount.addEventListener('input', function () { setTarget(+amount.value || 0); });
    slider.addEventListener('input', function () { setTarget(+slider.value); });

    Array.prototype.forEach.call(document.querySelectorAll('[data-days]'), function (btn) {
      btn.addEventListener('click', function () {
        state.days = +btn.getAttribute('data-days');
        Array.prototype.forEach.call(document.querySelectorAll('[data-days]'), function (b) {
          b.classList.toggle('is-on', +b.getAttribute('data-days') === state.days);
          b.setAttribute('aria-pressed', String(+b.getAttribute('data-days') === state.days));
        });
        save();
        render();
      });
      btn.classList.toggle('is-on', +btn.getAttribute('data-days') === state.days);
      btn.setAttribute('aria-pressed', String(+btn.getAttribute('data-days') === state.days));
    });

    el('clear').addEventListener('click', function () {
      if (!confirm('Remove every invoice stored in this browser?')) return;
      state.invoices = [];
      save();
      render();
      note('Cleared.');
    });

    el('export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ invoices: state.invoices }, null, 2)],
        { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'invoices.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  /* One tooltip, moved around — cheaper than a node per row. */
  function wireTooltip() {
    var tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;
    document.body.appendChild(tip);

    function show(target) {
      var text = target.getAttribute('data-tip');
      if (!text) return;
      tip.textContent = text;
      tip.hidden = false;
      var box = target.getBoundingClientRect();
      tip.style.top = (window.scrollY + box.top - tip.offsetHeight - 8) + 'px';
      tip.style.left = Math.max(8, window.scrollX + box.left + 12) + 'px';
    }
    function hide() { tip.hidden = true; }

    document.addEventListener('mouseover', function (e) {
      var row = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (row) show(row); else hide();
    });
    document.addEventListener('focusin', function (e) {
      var row = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (row) show(row);
    });
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, true);
  }

  /* When served over http, pick up whatever the Thursday fetcher wrote. */
  async function loadStoreFile() {
    if (location.protocol === 'file:') return;
    try {
      var res = await fetch('data/invoices.json', { cache: 'no-store' });
      if (!res.ok) return;
      var data = await res.json();
      var added = 0;
      (data.invoices || []).forEach(function (inv) {
        // The Python side writes snake_case; normalise to the shape used here.
        var normalised = inv.lineItems ? inv : {
          techId: inv.tech_id, name: inv.name, payPeriod: inv.pay_period,
          periodStart: inv.period_start, periodEnd: inv.period_end, source: inv.source,
          lineItems: inv.line_items, adjustments: inv.adjustments, printed: inv.printed
        };
        var existing = state.invoices.find(function (x) { return x.periodEnd === normalised.periodEnd; });
        if (!existing && addInvoice(normalised)) added++;
      });
      if (added) { save(); render(); note('Picked up ' + added + ' invoice(s) from data/invoices.json.'); }
    } catch (err) { /* no store file yet */ }
  }

  load();
  wireInput();
  wireControls();
  wireTooltip();
  render();
  loadStoreFile();
  loadTax();
})();
