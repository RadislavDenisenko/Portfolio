var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Reveal panels/sections as they scroll in.
(function () {
  var items = document.querySelectorAll('.panel, .reveal');
  if (!items.length) return;
  if (REDUCE || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
  items.forEach(function (el) { io.observe(el); });

  // Backstop: in a frame that never scrolls the observer may never fire, and
  // permanently invisible content is worse than un-animated content.
  setTimeout(function () {
    items.forEach(function (el) { el.classList.add('in'); });
  }, 2500);
})();

// Side-rail dots track the active screen.
(function () {
  var map = {
    hero: 'top', airmouse: 'airmouse', roomly: 'roomly',
    about: 'about', contact: 'contact'
  };
  var dots = document.querySelectorAll('.rail a');
  if (!dots.length || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      var key = map[e.target.id];
      dots.forEach(function (d) { d.classList.toggle('on', d.dataset.dot === key); });
    });
  }, { threshold: 0.45 });
  Object.keys(map).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) io.observe(el);
  });
})();

// Drifting hand skeleton — the same 21 landmarks AirMouse tracks — plus a
// "cursor" that follows the index fingertip, the way the real app drives yours.
(function () {
  var canvas = document.getElementById('hand');
  if (!canvas || !canvas.getContext) return;
  var cursor = document.getElementById('cam-cursor');

  var BONES = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17]
  ];
  var BASE = [
    [0.50,0.96],
    [0.31,0.85],[0.20,0.72],[0.13,0.60],[0.08,0.49],
    [0.37,0.55],[0.33,0.37],[0.31,0.25],[0.29,0.14],
    [0.51,0.51],[0.51,0.31],[0.51,0.18],[0.51,0.07],
    [0.64,0.54],[0.67,0.35],[0.69,0.23],[0.71,0.12],
    [0.76,0.61],[0.82,0.47],[0.86,0.38],[0.90,0.29]
  ];
  var TIP = 8; // index fingertip drives the cursor

  var ctx = canvas.getContext('2d');
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
    var pad = 30;
    // The whole hand wanders slowly; individual joints jitter a little on top,
    // which reads as live tracking rather than a looping GIF.
    var gx = Math.sin(t / 2600) * w * 0.07;
    var gy = Math.cos(t / 3100) * h * 0.05;
    var pts = BASE.map(function (p, i) {
      var dx = Math.sin(t / 1500 + i * 0.7) * 4;
      var dy = Math.cos(t / 1800 + i * 0.5) * 4;
      return [pad + p[0] * (w - pad * 2) + dx + gx, pad + p[1] * (h - pad * 2) + dy + gy];
    });

    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    BONES.forEach(function (b) {
      ctx.moveTo(pts[b[0]][0], pts[b[0]][1]);
      ctx.lineTo(pts[b[1]][0], pts[b[1]][1]);
    });
    ctx.stroke();

    pts.forEach(function (p, i) {
      var tip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
      ctx.beginPath();
      ctx.arc(p[0], p[1], tip ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = tip ? '#C8F542' : '#fff';
      ctx.fill();
    });

    if (cursor) {
      cursor.style.transform =
        'translate(' + (pts[TIP][0] - 7) + 'px,' + (pts[TIP][1] - 7) + 'px)';
    }
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
