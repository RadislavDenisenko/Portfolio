var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Reveal sections as they scroll in.
(function () {
  var items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  if (REDUCE || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  items.forEach(function (el) { io.observe(el); });
})();

// The name lights up like a shop sign, then the first board drops onto the
// second.
//
// These used to wait for scrollY, which meant they never fired when the page
// was embedded in a frame (the outer document scrolls, not this one) or simply
// was not tall enough to scroll. They now play on their own shortly after
// load, and scrolling only brings them forward.
(function () {
  var sign = document.querySelector('.sign');
  var plate = document.querySelector('.nameplate');
  if (REDUCE || (!sign && !plate)) return;

  var lit = false, dropped = false;

  function light() {
    if (lit || !sign) return;
    lit = true;
    sign.classList.add('lit');
  }
  function drop() {
    if (dropped || !plate) return;
    dropped = true;
    plate.classList.add('drop');
  }

  setTimeout(light, 550);
  setTimeout(drop, 1150);

  window.addEventListener('scroll', function () {
    if (window.scrollY > 20) light();
    if (window.scrollY > 60) drop();
  }, { passive: true });
})();

// Project boards unlatch from one screw and rock to a stop.
(function () {
  var boards = document.querySelectorAll('.board');
  if (!boards.length) return;
  if (REDUCE || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e, i) {
      if (!e.isIntersecting) return;
      var el = e.target;
      // stagger so a row of boards does not drop in unison
      setTimeout(function () { el.classList.add('swing'); }, i * 220);
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -14% 0px', threshold: 0.25 });
  boards.forEach(function (el) { io.observe(el); });

  // Backstop: in a frame that never scrolls, the observer may never fire.
  // Nobody should be looking at a board that refuses to unlatch.
  setTimeout(function () {
    boards.forEach(function (el, i) {
      if (el.classList.contains('swing')) return;
      setTimeout(function () { el.classList.add('swing'); }, i * 220);
    });
  }, 2600);
})();

// Drifting hand skeleton — the same 21 landmarks the app tracks.
(function () {
  var canvas = document.getElementById('hand');
  if (!canvas || !canvas.getContext) return;

  var BONES = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17]
  ];
  var BASE = [
    [0.50, 0.96],
    [0.31, 0.85], [0.20, 0.72], [0.13, 0.60], [0.08, 0.49],
    [0.37, 0.55], [0.33, 0.37], [0.31, 0.25], [0.29, 0.14],
    [0.51, 0.51], [0.51, 0.31], [0.51, 0.18], [0.51, 0.07],
    [0.64, 0.54], [0.67, 0.35], [0.69, 0.23], [0.71, 0.12],
    [0.76, 0.61], [0.82, 0.47], [0.86, 0.38], [0.90, 0.29]
  ];

  var ctx = canvas.getContext('2d');
  var css = getComputedStyle(document.documentElement);
  var red = css.getPropertyValue('--red').trim() || '#d2402c';
  var ink = css.getPropertyValue('--ink').trim() || '#17150f';
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = 0, h = 0;

  function size() {
    var r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    var pad = 20;
    var pts = BASE.map(function (p, i) {
      var dx = Math.sin(t / 1400 + i * 0.7) * 4.5;
      var dy = Math.cos(t / 1700 + i * 0.5) * 4.5;
      return [pad + p[0] * (w - pad * 2) + dx, pad + p[1] * (h - pad * 2) + dy];
    });

    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    ctx.beginPath();
    BONES.forEach(function (b) {
      ctx.moveTo(pts[b[0]][0], pts[b[0]][1]);
      ctx.lineTo(pts[b[1]][0], pts[b[1]][1]);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    pts.forEach(function (p, i) {
      var tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.beginPath();
      ctx.arc(p[0], p[1], tip ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = tip ? red : '#fbfaf6';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = ink;
      ctx.stroke();
    });
  }

  size();
  window.addEventListener('resize', size);
  if (REDUCE) { draw(0); return; }

  var running = true;
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden;
    if (running) requestAnimationFrame(loop);
  });
  function loop(t) {
    if (!running) return;
    draw(t);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
