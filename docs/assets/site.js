/* Radislav Denisenko — portfolio behavior.
   Plain script, no dependencies. The 3D hand lives in hand.js (ES module,
   lazy-imported only when the AirMouse section scrolls near). */
(function () {
  'use strict';

  /* JS marker: the hidden [data-reveal] initial state only applies with JS on,
     so the page is fully readable for crawlers / blocked scripts. */
  document.documentElement.classList.add('js');

  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* A fine pointer anywhere (mouse/trackpad) gets the cursor interactions —
     touchscreen laptops included. Coarse-only devices get static/calm modes. */
  var FINE = window.matchMedia('(any-pointer: fine)').matches ||
             window.matchMedia('(pointer: fine)').matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------- header hairline on scroll ---------- */
  var top = $('.top');
  if (top) {
    var onScroll = function () { top.classList.toggle('scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- entrance reveals (fade + 28px rise, 60ms stagger) ---------- */
  var revealables = $$('[data-reveal]');
  var revealNow = function (el, delay) {
    el.style.transitionDelay = delay + 'ms';
    el.classList.add('is-in');
    /* clear the stagger delay once the entrance lands, so hover transitions
       (which share the same transition) start instantly afterwards */
    setTimeout(function () { el.style.transitionDelay = ''; }, delay + 600);
  };
  if (REDUCE) {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  } else if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      var batch = 0;
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        revealNow(el, batch++ * 60);
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealables.forEach(function (el) { io.observe(el); });

    /* backstop: only elements at or above the current viewport get force-shown;
       everything below the fold stays with the observer so its entrance plays */
    setTimeout(function () {
      $$('[data-reveal]:not(.is-in)').forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          io.unobserve(el);
          revealNow(el, 0);
        }
      });
    }, 2500);
  } else {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- hero headline: letters spring in one-by-one ---------- */
  var heroH = $('.hero-h');
  if (heroH && !REDUCE) {
    var idx = 0;
    var split = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span');
            w.className = 'w';
            part.split('').forEach(function (ch) {
              var s = document.createElement('span');
              s.className = 'ch';
              s.style.setProperty('--i', idx++);
              s.textContent = ch;
              w.appendChild(s);
            });
            frag.appendChild(w);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) {
          split(n);
        }
      });
    };
    heroH.setAttribute('aria-label', heroH.textContent.replace(/\s+/g, ' ').trim());
    split(heroH);
    $$('.w', heroH).forEach(function (w) { w.setAttribute('aria-hidden', 'true'); });
    /* the sun highlight paints itself only after its own letters have landed.
       The delay rides a custom property consumed by the .letters-in .hl rule —
       setting an inline transition-delay here would spawn a phantom 'all 0s'
       transition when .letters commits the 0% state, pinning the bar at 100%
       and killing the wipe. Custom-property writes never start transitions. */
    $$('.hl', heroH).forEach(function (hl) {
      var chs = $$('.ch', hl);
      if (!chs.length) return;
      var lastI = parseInt(chs[chs.length - 1].style.getPropertyValue('--i'), 10) || 0;
      hl.style.setProperty('--hl-delay', (lastI * 26 + 140) + 'ms');
    });
    heroH.classList.add('letters');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { heroH.classList.add('letters-in'); });
    });
  }

  /* ---------- hero stage: spring-smoothed 3D tilt toward the cursor ---------- */
  var tiltStage = $('#tilt-stage');
  var hero = $('.hero');
  if (tiltStage && hero && !REDUCE && FINE) {
    var tx = 0, ty = 0, cx = 0, cy = 0, vx = 0, vy = 0, tiltRaf = null;
    var tiltStep = function () {
      vx += (tx - cx) * 0.055; vx *= 0.84; cx += vx;
      vy += (ty - cy) * 0.055; vy *= 0.84; cy += vy;
      tiltStage.style.transform =
        'rotateX(' + cx.toFixed(3) + 'deg) rotateY(' + cy.toFixed(3) + 'deg)';
      if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002 ||
          Math.abs(vx) > 0.002 || Math.abs(vy) > 0.002) {
        tiltRaf = requestAnimationFrame(tiltStep);
      } else { tiltRaf = null; }
    };
    var kick = function () { if (tiltRaf === null) tiltRaf = requestAnimationFrame(tiltStep); };
    hero.addEventListener('mousemove', function (e) {
      var r = tiltStage.getBoundingClientRect();
      var nx = (e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1);
      var ny = (e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1);
      ty = Math.max(-1, Math.min(1, nx)) * 7;    /* rotateY follows x */
      tx = Math.max(-1, Math.min(1, ny)) * -5;   /* rotateX opposes y */
      kick();
    });
    hero.addEventListener('mouseleave', function () { tx = 0; ty = 0; kick(); });
  }

  /* ---------- Roomly: tear the top card off on a loop ---------- */
  var deck = $('#deck');
  if (deck && !REDUCE) {
    var cards = $$('.rcard', deck);
    var timer = null;
    var tearing = false;
    var deckVisible = false;
    var restack = function () {
      cards.forEach(function (c, i) {
        c.className = 'rcard c' + Math.min(i, 3);
      });
    };
    var tick = function () {
      if (tearing || document.hidden) return;
      tearing = true;
      var topCard = cards[0];
      topCard.classList.add('tear');
      setTimeout(function () {
        topCard.style.transition = 'none';
        deck.appendChild(topCard);
        cards.push(cards.shift());
        restack();
        /* force reflow, then restore the transition so it settles in place */
        void topCard.offsetWidth;
        topCard.style.transition = '';
        tearing = false;
      }, 700);
    };
    var start = function () { if (!timer) timer = setInterval(tick, 4000); };
    var stop = function () { if (timer) { clearInterval(timer); timer = null; } };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          deckVisible = en.isIntersecting;
          deckVisible ? start() : stop();
        });
      }, { threshold: 0.2 }).observe(deck);
    } else { deckVisible = true; start(); }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else if (deckVisible) start();
    });
  }

  /* ---------- AirMouse: lazy-init the 3D hand when the section nears ---------- */
  var initHandOn = function (el, opts) {
    import('./hand.js')
      .then(function (m) { m.initHand(el, opts); })
      .catch(function (err) {
        el.classList.add('hand-fallback');
        if (window.console) console.warn('hand scene unavailable', err);
      });
  };
  var handStage = $('#hand-stage'); /* homepage and airmouse/ both use this id */
  if (handStage) {
    var opts = {
      statik: !FINE || REDUCE,
      autoPulse: handStage.hasAttribute('data-auto-pulse')
    };
    if (opts.statik) {
      /* static frame = not a button. Tell the truth to AT and in the caption. */
      handStage.removeAttribute('tabindex');
      handStage.setAttribute('role', 'img');
      handStage.setAttribute('aria-label',
        'Scanned 3D hand with the 21 tracked landmarks highlighted.');
      handStage.classList.add('is-static');
      var cap = $('[data-cap-static]');
      if (cap) cap.textContent = cap.getAttribute('data-cap-static');
    }
    if ('IntersectionObserver' in window) {
      var hio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          hio.disconnect();
          initHandOn(handStage, opts);
        });
      }, { rootMargin: '600px 0px 600px 0px' });
      hio.observe(handStage);
    } else {
      initHandOn(handStage, opts);
    }
  }
})();
