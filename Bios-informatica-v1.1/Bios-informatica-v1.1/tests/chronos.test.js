'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '../public/js/chronos.js'), 'utf8');

function browser({ reduced = false, fine = true, failImage = false, branded = false, dpr = 1, width = 336, height = 364 } = {}) {
  function target() {
    const listeners = new Map();
    return {
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(callback);
      },
      emit(name, event = {}) { (listeners.get(name) || []).forEach(fn => fn(event)); }
    };
  }
  const drawings = [];
  const context = {
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low',
    clearRect() {},
    drawImage(...args) { drawings.push(args.slice(1)); }
  };
  const canvas = { hidden: true, getContext: () => context,
    getBoundingClientRect: () => ({ left: 100, top: 50, width, height }) };
  const fallback = { hidden: false };
  const scope = target();
  const root = { dataset: { chronos: branded ? '/assets/chronos/chronos-bios-atlas.png' : '/assets/chronos/chronos-sprite.webp' },
    querySelector: selector => selector === 'canvas' ? canvas : fallback, closest: () => scope };
  const document = Object.assign(target(), { hidden: false, querySelectorAll: () => [root] });
  const motion = Object.assign(target(), { matches: reduced });
  const pointer = Object.assign(target(), { matches: fine });
  const timers = new Map();
  const frames = new Map();
  let sequence = 0;
  let intersection;
  const window = Object.assign(target(), {
    devicePixelRatio: dpr,
    matchMedia: query => query.includes('reduced-motion') ? motion : pointer,
    setTimeout: fn => { timers.set(++sequence, fn); return sequence; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; },
    cancelAnimationFrame: id => frames.delete(id),
    IntersectionObserver: class {
      constructor(callback) { intersection = callback; }
      observe() {}
    }
  });
  class Image {
    naturalWidth = branded ? 1968 : 1536;
    naturalHeight = branded ? 799 : 624;
    set src(value) { if (!failImage) this.onload(); }
  }
  vm.runInNewContext(code, { document, window, Image });
  const face = { x: 100 + 336 * 0.57, y: 50 + 364 * 0.47 };
  return { canvas, fallback, drawings, context, scope, document, motion, window, timers, frames,
    intersect: value => intersection([{ isIntersecting: value }]),
    move(dx, dy, type = 'mouse') {
      scope.emit('pointermove', { clientX: face.x + dx, clientY: face.y + dy, pointerType: type });
    },
    flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
    pose() { const draw = drawings.at(-1); return draw && [draw[0] / 192, draw[1] / 208]; }
  };
}

test('Chronos follows all sixteen clockwise directions and resets when the pointer leaves', () => {
  const b = browser();
  assert.equal(b.canvas.hidden, false);
  assert.equal(b.fallback.hidden, true);
  for (let direction = 0; direction < 16; direction++) {
    b.scope.emit('pointerleave');
    const angle = direction * Math.PI / 8;
    b.move(Math.sin(angle) * 180, -Math.cos(angle) * 180);
    b.flush();
    assert.deepEqual(b.pose(), [direction % 8, 1 + Math.floor(direction / 8)]);
    assert.equal(b.timers.size, 0, 'idle timer stops while looking');
  }
  b.scope.emit('pointerleave');
  assert.deepEqual(b.pose(), [0, 0]);
  assert.equal(b.timers.size, 1);
});

test('Center deadzone, boundary stability and pointer events share at most one pending paint', () => {
  const b = browser();
  b.move(180, 0); b.move(180, 1); b.move(180, 2);
  assert.equal(b.frames.size, 1);
  b.flush();
  assert.deepEqual(b.pose(), [4, 1]);
  const angle = Math.PI / 2 + Math.PI / 16 + 0.01;
  b.move(Math.sin(angle) * 180, -Math.cos(angle) * 180); b.flush();
  assert.deepEqual(b.pose(), [4, 1], 'a slight movement at a sector edge does not flicker');
  b.move(0, 0); b.flush();
  assert.deepEqual(b.pose(), [0, 0]);
});

test('Touch stays idle and reduced motion or failed sprite loading preserves the fallback', () => {
  const touch = browser({ fine: false });
  touch.move(-100, 0, 'touch'); touch.flush();
  assert.deepEqual(touch.pose(), [0, 0]);
  const reduced = browser({ reduced: true });
  reduced.move(100, 0); reduced.flush();
  assert.equal(reduced.canvas.hidden, true);
  assert.equal(reduced.fallback.hidden, false);
  assert.equal(reduced.timers.size, 0);
  const failed = browser({ failImage: true });
  assert.equal(failed.fallback.hidden, false);
  assert.equal(failed.canvas.hidden, true);
});

test('Hidden tabs and offscreen mascot stop animation; scrolling clears pending gaze', () => {
  const b = browser();
  b.move(120, 0);
  b.window.emit('scroll');
  assert.equal(b.frames.size, 0);
  b.intersect(false);
  assert.equal(b.timers.size, 0);
  b.move(100, 0);
  assert.equal(b.frames.size, 0);
  b.intersect(true);
  assert.equal(b.timers.size, 1);
  b.document.hidden = true;
  b.document.emit('visibilitychange');
  assert.equal(b.timers.size, 0);
  b.document.hidden = false;
  b.document.emit('visibilitychange');
  assert.equal(b.timers.size, 1);
});

test('Branded atlas preserves all sixteen directions without cropping adjacent frames',()=>{
  const b=browser({branded:true});assert.equal(b.canvas.hidden,false);
  for(let i=0;i<16;i++){b.scope.emit('pointerleave');const a=i*Math.PI/8;b.move(Math.sin(a)*180,-Math.cos(a)*180);b.flush();const d=b.drawings.at(-1);assert.equal(d[0],(i%8)*246);assert.equal(d[1],[40,306,559][1+Math.floor(i/8)]);assert.equal(d[2],246);assert.equal(d[3],240);assert(d[0]+d[2]<=1968);assert(d[1]+d[3]<=799);}
});

test('Canvas buffer dimensions match CSS size and devicePixelRatio with aspect-fit centering and smooth rendering', () => {
  // Test 1x density
  const b1 = browser({ branded: true, dpr: 1 });
  assert.equal(b1.canvas.hidden, false);
  assert.equal(b1.canvas.width, 336);
  assert.equal(b1.canvas.height, 364);
  b1.scope.emit('pointerleave');
  b1.move(180, 0);
  b1.flush();
  const d1 = b1.drawings.at(-1);
  // Source crop
  assert.equal(d1[2], 246);
  assert.equal(d1[3], 240);
  // Destination: aspect-fit inside 336x364 without stretching
  assert.equal(d1[4], 0); // dx centered
  assert.equal(d1[5], 18); // dy centered vertically
  assert.equal(d1[6], 336); // destW
  assert.equal(d1[7], 328); // destH (preserves 246/240 aspect ratio)
  assert.equal(b1.context.imageSmoothingEnabled, true);
  assert.equal(b1.context.imageSmoothingQuality, 'high');

  // Test 2x density (HiDPI / Retina)
  const b2 = browser({ branded: true, dpr: 2 });
  assert.equal(b2.canvas.hidden, false);
  assert.equal(b2.canvas.width, 672);
  assert.equal(b2.canvas.height, 728);
  b2.scope.emit('pointerleave');
  b2.move(180, 0);
  b2.flush();
  const d2 = b2.drawings.at(-1);
  assert.equal(d2[2], 246);
  assert.equal(d2[3], 240);
  // Destination at 2x: aspect-fit inside 672x728 without stretching
  assert.equal(d2[4], 0); // dx centered
  assert.equal(d2[5], 36); // dy centered vertically
  assert.equal(d2[6], 672); // destW (336 * 2)
  assert.equal(d2[7], 656); // destH (328 * 2)
  assert.equal(b2.context.imageSmoothingEnabled, true);
  assert.equal(b2.context.imageSmoothingQuality, 'high');

  // Test native 336x328 bounds (matching 246/240 aspect ratio exactly)
  const b3 = browser({ branded: true, dpr: 1, width: 336, height: 328 });
  assert.equal(b3.canvas.width, 336);
  assert.equal(b3.canvas.height, 328);
  b3.scope.emit('pointerleave');
  b3.move(180, 0);
  b3.flush();
  const d3 = b3.drawings.at(-1);
  assert.equal(d3[4], 0); // dx = 0
  assert.equal(d3[5], 0); // dy = 0 (no offset, perfect 1:1 baseline)
  assert.equal(d3[6], 336); // destW = 336
  assert.equal(d3[7], 328); // destH = 328
});

