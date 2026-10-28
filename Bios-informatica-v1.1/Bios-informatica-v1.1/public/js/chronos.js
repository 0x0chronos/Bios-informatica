'use strict';

// Local-only pointer coordinates; no cookies, network calls or analytics.
(() => {
  const CELL_WIDTH = 192;
  const CELL_HEIGHT = 208;
  const STEP = Math.PI / 8;
  const IDLE_DURATIONS = [280, 110, 110, 140, 140, 1900];

  document.querySelectorAll('[data-chronos]').forEach(root => {
    const canvas = root.querySelector('canvas');
    const fallback = root.querySelector('img');
    const scope = root.closest('[data-chronos-scope]') || root;
    const context = canvas && canvas.getContext('2d');
    if (!context || !fallback) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');
    const sprite = new Image();
    const brandedAtlas = root.dataset.brandedAtlas === 'true' || root.dataset.chronos.includes('chronos-bios-atlas');
    let ready = false;
    let visible = true;
    let look = null;
    let pointer = null;
    let idleFrame = 0;
    let idleTimer = null;
    let paintRequest = null;

    let currentPose = { row: 0, column: 0 };

    function active() {
      return ready && visible && !document.hidden && !reducedMotion.matches;
    }

    function syncCanvasSize() {
      const bounds = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      const cssW = (bounds && bounds.width) || (canvas && canvas.clientWidth) || CELL_WIDTH;
      const cssH = (bounds && bounds.height) || (canvas && canvas.clientHeight) || CELL_HEIGHT;
      const forcedDpr = root.dataset.chronosDpr ? parseFloat(root.dataset.chronosDpr) : null;
      const dpr = forcedDpr || ((typeof window !== 'undefined' && window.devicePixelRatio) ? Math.max(1, window.devicePixelRatio) : 1);
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);
      if (canvas && (canvas.width !== targetW || canvas.height !== targetH)) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      return { width: targetW, height: targetH };
    }

    function draw(row, column) {
      currentPose = { row, column };
      const { width: targetW, height: targetH } = syncCanvasSize();
      context.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in context) {
        context.imageSmoothingQuality = 'high';
      }
      context.clearRect(0, 0, targetW, targetH);
      let sx, sy, sWidth, sHeight;
      if (brandedAtlas) {
        // The edited atlas retains 8 columns; row crops preserve the feet baseline.
        sy = [40, 306, 559][row];
        sx = column * 246;
        sWidth = 246;
        sHeight = 240;
      } else {
        sx = column * CELL_WIDTH;
        sy = row * CELL_HEIGHT;
        sWidth = CELL_WIDTH;
        sHeight = CELL_HEIGHT;
      }

      // Preserve native aspect ratio (contain) and center within destination buffer
      const scale = Math.min(targetW / sWidth, targetH / sHeight);
      const destW = Math.round(sWidth * scale);
      const destH = Math.round(sHeight * scale);
      const destX = Math.round((targetW - destW) / 2);
      const destY = Math.round((targetH - destH) / 2);
      context.drawImage(sprite, sx, sy, sWidth, sHeight, destX, destY, destW, destH);
    }

    function stop() {
      window.clearTimeout(idleTimer);
      idleTimer = null;
      if (paintRequest !== null) window.cancelAnimationFrame(paintRequest);
      paintRequest = null;
    }

    function scheduleIdle() {
      if (!active() || look !== null || idleTimer !== null) return;
      idleTimer = window.setTimeout(() => {
        idleTimer = null;
        if (!active() || look !== null) return;
        idleFrame = (idleFrame + 1) % IDLE_DURATIONS.length;
        draw(0, idleFrame);
        scheduleIdle();
      }, IDLE_DURATIONS[idleFrame]);
    }

    function rest() {
      stop();
      pointer = null;
      look = null;
      idleFrame = 0;
      if (!active()) return;
      draw(0, 0);
      scheduleIdle();
    }

    function paintPointer() {
      paintRequest = null;
      if (!active() || !pointer || !finePointer.matches) return;
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      // Aim from the face, rather than the center of the whole character.
      const dx = pointer.x - (bounds.left + bounds.width * 0.57);
      const dy = pointer.y - (bounds.top + bounds.height * 0.47);
      const deadzone = Math.max(20, bounds.width * 0.085);
      if (Math.hypot(dx, dy) < deadzone) {
        rest();
        return;
      }
      const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
      let next = Math.round(angle / STEP) % 16;
      if (look !== null) {
        const distance = Math.atan2(Math.sin(angle - look * STEP), Math.cos(angle - look * STEP));
        // A small margin keeps the head steady at sector boundaries.
        if (Math.abs(distance) < STEP / 2 + 0.055) next = look;
      }
      if (next === look) return;
      window.clearTimeout(idleTimer);
      idleTimer = null;
      look = next;
      draw(1 + Math.floor(look / 8), look % 8);
    }

    function queuePointer(event) {
      if (!active() || !finePointer.matches || !['mouse', 'pen'].includes(event.pointerType)) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (paintRequest === null) paintRequest = window.requestAnimationFrame(paintPointer);
    }

    function updateAvailability() {
      stop();
      canvas.hidden = !ready || reducedMotion.matches;
      fallback.hidden = ready && !reducedMotion.matches;
      rest();
    }

    function handleResize() {
      if (!active()) return;
      syncCanvasSize();
      draw(currentPose.row, currentPose.column);
    }

    scope.addEventListener('pointermove', queuePointer, { passive: true });
    scope.addEventListener('pointerleave', rest);
    scope.addEventListener('pointercancel', rest);
    window.addEventListener('blur', rest);
    // Reset on scroll/resize so cached pointer coordinates cannot leave a stale gaze.
    window.addEventListener('scroll', rest, { passive: true });
    window.addEventListener('resize', () => {
      rest();
      handleResize();
    }, { passive: true });
    document.addEventListener('visibilitychange', updateAvailability);
    reducedMotion.addEventListener('change', updateAvailability);
    finePointer.addEventListener('change', rest);

    if (typeof window !== 'undefined' && 'ResizeObserver' in window) {
      const ro = new window.ResizeObserver(() => {
        handleResize();
      });
      ro.observe(canvas.parentElement || root);
    }

    if ('IntersectionObserver' in window) {
      const observer = new window.IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        rest();
      }, { threshold: 0.05 });
      observer.observe(root);
    }

    sprite.onload = () => {
      if (brandedAtlas ? (sprite.naturalWidth !== 1968 || sprite.naturalHeight !== 799) : (sprite.naturalWidth !== CELL_WIDTH * 8 || sprite.naturalHeight !== CELL_HEIGHT * 3)) return;
      ready = true;
      updateAvailability();
    };
    // If the sprite cannot load, the normal image stays visible.
    sprite.src = root.dataset.chronos;
  });
})();
