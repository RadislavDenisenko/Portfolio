// Reveal sections as they scroll in.
(function () {
  var items = document.querySelectorAll('.reveal');
  if (!items.length) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

  items.forEach(function (el) { io.observe(el); });
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

  // Roughly an open right hand, in a 0..1 box.
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
  var accent = css.getPropertyValue('--accent').trim() || '#c25e4a';
  var line = css.getPropertyValue('--line').trim() || '#453c33';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    var pad = 18;
    var pts = BASE.map(function (p, i) {
      // each landmark breathes on its own phase, so the hand never looks rigid
      var dx = Math.sin(t / 1400 + i * 0.7) * 4.5;
      var dy = Math.cos(t / 1700 + i * 0.5) * 4.5;
      return [pad + p[0] * (w - pad * 2) + dx, pad + p[1] * (h - pad * 2) + dy];
    });

    ctx.strokeStyle = line;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    BONES.forEach(function (b) {
      ctx.moveTo(pts[b[0]][0], pts[b[0]][1]);
      ctx.lineTo(pts[b[1]][0], pts[b[1]][1]);
    });
    ctx.stroke();

    pts.forEach(function (p, i) {
      var tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.beginPath();
      ctx.arc(p[0], p[1], tip ? 3.6 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = tip ? accent : '#9d938a';
      ctx.fill();
    });
  }

  size();
  window.addEventListener('resize', size);

  if (reduce) { draw(0); return; }

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
