(() => {
  const root = document.documentElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const THEME_KEY = 'oloweb-theme';
  const THEME_COLOR = { light: '#f4f4f1', dark: '#0c0c0c' };

  /* Theme ------------------------------------------------------------------ */

  const toggle = document.querySelector('[data-theme-toggle]');
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  const currentTheme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

  const applyTheme = (theme) => {
    root.dataset.theme = theme;
    toggle.setAttribute('aria-checked', String(theme === 'dark'));
    if (metaTheme) metaTheme.setAttribute('content', THEME_COLOR[theme]);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  };

  toggle.setAttribute('aria-checked', String(currentTheme() === 'dark'));

  // Fetch the other theme's artwork before it is needed, so the switch is instant.
  let warmed = false;
  const warmOtherTheme = () => {
    if (warmed) return;
    warmed = true;
    const other = currentTheme() === 'dark' ? 'light' : 'dark';
    document.querySelectorAll(`img.only-${other}`).forEach((img) => {
      const pre = new Image();
      pre.src = img.getAttribute('src');
    });
  };
  toggle.addEventListener('pointerenter', warmOtherTheme);
  toggle.addEventListener('focus', warmOtherTheme);
  toggle.addEventListener('touchstart', warmOtherTheme, { passive: true });

  toggle.addEventListener('click', (event) => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    warmed = false;

    if (!document.startViewTransition || reduceMotion.matches) {
      applyTheme(next);
      return;
    }

    // Reveal the new theme as a circle growing out of the toggle.
    const box = toggle.getBoundingClientRect();
    const x = event.detail ? event.clientX : box.left + box.width / 2;
    const y = event.detail ? event.clientY : box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    const transition = document.startViewTransition(() => applyTheme(next));
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 750, easing: 'cubic-bezier(.65, 0, .25, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
  });

  /* Reveal on scroll ------------------------------------------------------- */

  const revealables = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const revealer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -6% 0px' });
    revealables.forEach((el) => revealer.observe(el));
  } else {
    revealables.forEach((el) => el.classList.add('is-in'));
  }

  /* Copy email ------------------------------------------------------------- */

  document.querySelectorAll('[data-copy]').forEach((button) => {
    const status = button.parentElement.querySelector('[data-copy-status]');
    let timer;
    button.addEventListener('click', async () => {
      const text = button.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(field);
        field.select();
        try { document.execCommand('copy'); } catch (err) {}
        field.remove();
      }
      button.textContent = 'Copied';
      button.classList.add('is-done');
      if (status) status.textContent = 'Email address copied';
      clearTimeout(timer);
      timer = setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('is-done');
        if (status) status.textContent = '';
      }, 1800);
    });
  });

  /* Steer screenshots ------------------------------------------------------ */

  document.querySelectorAll('[data-gallery]').forEach((gallery) => {
    const frame = gallery.querySelector('[data-gallery-frame]');
    const slides = [...frame.querySelectorAll('img')];
    const thumbs = [...gallery.querySelectorAll('.shots__thumbs button')];
    let index = 0;

    const show = (next) => {
      index = (next + slides.length) % slides.length;
      slides.forEach((img, i) => {
        img.classList.toggle('is-active', i === index);
        img.setAttribute('aria-hidden', String(i !== index));
      });
      thumbs.forEach((thumb, i) => thumb.setAttribute('aria-current', String(i === index)));
    };

    thumbs.forEach((thumb, i) => thumb.addEventListener('click', () => show(i)));
    gallery.querySelector('[data-gallery-prev]').addEventListener('click', () => show(index - 1));
    gallery.querySelector('[data-gallery-next]').addEventListener('click', () => show(index + 1));

    // Arrow keys work anywhere inside the gallery; focus follows along the thumbnails.
    gallery.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      show(index + (e.key === 'ArrowRight' ? 1 : -1));
      if (thumbs.includes(document.activeElement)) thumbs[index].focus();
    });

    // Tap / click advances; a horizontal swipe goes either way.
    let startX = null;
    frame.addEventListener('pointerdown', (e) => { if (e.button === 0) startX = e.clientX; });
    frame.addEventListener('pointerup', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
      else show(index + 1);
    });
    frame.addEventListener('pointercancel', () => { startX = null; });
  });

  /* Coinsta: a star you can fidget with ------------------------------------ */

  const fidget = document.querySelector('[data-fidget]');
  if (fidget) {
    const stars = [...fidget.querySelectorAll('.c-star')].map((g) => ({
      g,
      svg: g.ownerSVGElement,
      cx: parseFloat(g.dataset.cx),
      cy: parseFloat(g.dataset.cy),
    }));

    const DECEL = 0.0007;   // deg/ms² — how quickly a spin dies down
    const TAP = 1.4;        // deg/ms added per tap
    const MAX = 3;          // deg/ms cap

    let angle = 0;
    let motion = null;      // { from, to, start, dur, v0, kind }
    let frame = 0;
    let drag = null;
    let suppressClick = false;
    let velocityAtPress = null;

    const render = () => {
      const a = angle.toFixed(2);
      stars.forEach((s) => s.g.setAttribute('transform', `rotate(${a} ${s.cx} ${s.cy})`));
    };

    const velocityNow = (now = performance.now()) => {
      if (!motion || motion.kind !== 'spin') return 0;
      const p = Math.min(1, (now - motion.start) / motion.dur);
      return motion.v0 * (1 - p);
    };

    const advance = (now) => {
      if (!motion) return;
      const p = Math.min(1, (now - motion.start) / motion.dur);
      const eased = motion.kind === 'spin' ? 1 - (1 - p) ** 2 : 1 - (1 - p) ** 3;
      angle = motion.from + (motion.to - motion.from) * eased;
      if (p >= 1) {
        angle = 0; // every motion ends on a whole turn, so this is the same pose
        motion = null;
      }
    };

    const tick = (now) => {
      frame = 0;
      if (!drag) advance(now);
      render();
      if (motion || drag) frame = requestAnimationFrame(tick);
    };

    const run = () => { if (!frame) frame = requestAnimationFrame(tick); };

    // Spin with an initial angular velocity (deg/ms), decelerating evenly so
    // the star always comes to rest upright, on a whole turn.
    const spin = (v) => {
      const now = performance.now();
      const dir = Math.sign(v) || 1;
      const speed = Math.min(Math.abs(v), MAX);

      if (speed < 0.08) {
        const to = Math.round(angle / 360) * 360;
        motion = { from: angle, to, start: now, dur: 380 + Math.abs(to - angle) * 2.2, kind: 'settle' };
      } else {
        let to = Math.round((angle + dir * (speed * speed) / (2 * DECEL)) / 360) * 360;
        if ((to - angle) * dir <= 0) to += dir * 360;
        const distance = Math.abs(to - angle);
        motion = { from: angle, to, start: now, dur: (2 * distance) / speed, v0: dir * speed, kind: 'spin' };
      }
      run();
    };

    const centre = () => {
      const s = stars.find((star) => star.svg.getBoundingClientRect().width > 0) || stars[0];
      const m = s.svg.getScreenCTM();
      return { x: m.a * s.cx + m.c * s.cy + m.e, y: m.b * s.cx + m.d * s.cy + m.f };
    };

    const pointerAngle = (e, c) => (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI;

    fidget.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      velocityAtPress = velocityNow();
      // catch the star where it is right now
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      advance(performance.now());
      motion = null;
      const c = centre();
      drag = { c, last: pointerAngle(e, c), travel: 0, x: e.clientX, y: e.clientY, samples: [{ t: e.timeStamp, a: angle }] };
      fidget.setPointerCapture(e.pointerId);
      run();
    });

    fidget.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const a = pointerAngle(e, drag.c);
      let delta = a - drag.last;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      drag.last = a;
      angle += delta;
      drag.travel += Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.samples.push({ t: e.timeStamp, a: angle });
      while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
    });

    const release = (e) => {
      if (!drag) return;
      const { travel, samples } = drag;
      drag = null;
      if (travel > 6) {
        suppressClick = true;
        velocityAtPress = null;
        const first = samples[0];
        const dt = Math.max(16, e.timeStamp - first.t);
        spin((angle - first.a) / dt);
      } else if (e.type === 'pointercancel') {
        spin(0);
      } else {
        // a plain tap is handled by the click listener; never leave the star askew
        setTimeout(() => { if (!motion && !drag && angle % 360 !== 0) spin(0); }, 350);
      }
    };

    fidget.addEventListener('pointerup', release);
    fidget.addEventListener('pointercancel', release);

    fidget.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      const v = velocityAtPress ?? velocityNow();
      velocityAtPress = null;
      spin((Math.sign(v) || 1) * (Math.abs(v) + TAP));
    });

    // A single spin the first time it scrolls into view, as a hint.
    if (!reduceMotion.matches && 'IntersectionObserver' in window) {
      const hint = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        hint.disconnect();
        setTimeout(() => { if (!motion && !drag && angle === 0) spin(1.05); }, 450);
      }, { threshold: 1 });
      hint.observe(fidget);
    }
  }

  /* Footer year ------------------------------------------------------------ */

  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = String(new Date().getFullYear());
  });
})();
