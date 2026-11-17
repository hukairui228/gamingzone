// Unified input: keyboard + mouse (pointer lock), gamepad, touch.
import { clamp } from './util.js';

const KEYMAP = {
  fire: [], aim: [], jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], enter: ['KeyF', 'Enter'],
  weapon: ['KeyQ'], focus: ['KeyE'], horn: ['KeyH'], radio: ['KeyR'], pause: ['Escape', 'KeyM'], photo: ['KeyP'],
  taxi: ['KeyT'], cam: ['KeyC'], lookback: ['KeyV'], interact: ['KeyF'], grenade: ['KeyG'],
  w1: ['Digit1'], w2: ['Digit2'], w3: ['Digit3'], w4: ['Digit4'], w5: ['Digit5'], w6: ['Digit6'], w7: ['Digit7'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.down = {}; this.prev = {};
    this.mouse = { dx: 0, dy: 0, b0: false, b2: false, wheel: 0 };
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.touchMode = false;
    this.touch = { stick: { x: 0, y: 0, id: null, cx: 0, cy: 0 }, look: { id: null, lx: 0, ly: 0 }, btn: {} };
    this.gp = null;
    this.locked = false;
    this.enabled = true;

    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.b0 = this.mouse.b2 = false; });
    canvas.addEventListener('mousedown', (e) => {
      if (this.touchMode) return;
      if (!this.locked && this.wantLock) { canvas.requestPointerLock?.(); }
      if (e.button === 0) this.mouse.b0 = true;
      if (e.button === 2) this.mouse.b2 = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.b0 = false; if (e.button === 2) this.mouse.b2 = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });

    // touch
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) this.setupTouch();
  }

  setupTouch() {
    const stick = document.getElementById('stick'), knob = document.getElementById('stickknob');
    const T = this.touch;
    const startTouch = () => { if (!this.touchMode) { this.touchMode = true; document.body.classList.add('touch'); this.onTouchMode && this.onTouchMode(); } };
    stick.addEventListener('touchstart', (e) => {
      startTouch(); e.preventDefault();
      const t = e.changedTouches[0]; const r = stick.getBoundingClientRect();
      T.stick.id = t.identifier; T.stick.cx = r.left + r.width / 2; T.stick.cy = r.top + r.height / 2;
    }, { passive: false });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.stick.id) {
          const dx = (t.clientX - T.stick.cx) / 60, dy = (t.clientY - T.stick.cy) / 60;
          const L = Math.hypot(dx, dy), s = L > 1 ? 1 / L : 1;
          T.stick.x = dx * s; T.stick.y = dy * s;
          knob.style.transform = `translate(${T.stick.x * 50}px, ${T.stick.y * 50}px)`;
        } else if (t.identifier === T.look.id) {
          this.mouse.dx += (t.clientX - T.look.lx) * 2.2; this.mouse.dy += (t.clientY - T.look.ly) * 2.2;
          T.look.lx = t.clientX; T.look.ly = t.clientY;
        }
      }
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === T.stick.id) { T.stick.id = null; T.stick.x = T.stick.y = 0; knob.style.transform = ''; }
        if (t.identifier === T.look.id) T.look.id = null;
      }
    };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
    this.canvas.addEventListener('touchstart', (e) => {
      startTouch(); e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.clientX > innerWidth * 0.35 && T.look.id === null) { T.look.id = t.identifier; T.look.lx = t.clientX; T.look.ly = t.clientY; }
      }
    }, { passive: false });
    document.querySelectorAll('#tbtns .tb').forEach((b) => {
      const k = b.dataset.k;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); T.btn[k] = true; }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); T.btn[k] = false; }, { passive: false });
    });
    document.getElementById('tpause').addEventListener('touchstart', (e) => { e.preventDefault(); T.btn.pause = true; setTimeout(() => (T.btn.pause = false), 120); }, { passive: false });
  }

  key(name) {
    const codes = KEYMAP[name];
    if (codes) for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  poll() {
    // compute logical button states
    const d = {};
    for (const n in KEYMAP) d[n] = this.key(n);
    d.fire = this.mouse.b0; d.aim = this.mouse.b2;
    const T = this.touch;
    for (const k in T.btn) if (T.btn[k]) d[k] = true;
    if (T.btn.fire) d.aim = true; // touch fire implies aim
    let mx = 0, my = 0;
    if (this.key('dummy')) mx = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (T.stick.id !== null) { mx = T.stick.x; my = -T.stick.y; }
    let lx = this.mouse.dx, ly = this.mouse.dy;
    this.mouse.dx = this.mouse.dy = 0;
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find((p) => p && p.connected);
    this.gpActive = false;
    this.throttleAxis = null;
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      const ax = dz(gp.axes[0]), ay = dz(gp.axes[1]), rx = dz(gp.axes[2]), ry = dz(gp.axes[3]);
      if (ax || ay) { mx = ax; my = -ay; this.gpActive = true; }
      if (rx || ry) { lx += rx * 14; ly += ry * 10; this.gpActive = true; }
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const v = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      if (b(7)) d.fire = true; if (b(6)) d.aim = true;
      if (b(0)) d.jump = true; if (b(3)) d.enter = true; if (b(10)) d.sprint = true; if (b(2)) d.sprint = true;
      if (b(5)) d.weapon = true; if (b(4)) d.focus = true; if (b(9)) d.pause = true; if (b(11)) d.horn = true;
      if (b(1)) d.cam = true; if (b(12)) d.radio = true; if (b(13)) d.lookback = true;
      if (v(7) > 0.05 || v(6) > 0.05) { this.throttleAxis = v(7) - v(6); this.gpActive = true; }
    }
    this.move.x = clamp(mx, -1, 1); this.move.y = clamp(my, -1, 1);
    this.look.x = lx; this.look.y = ly;
    this.prev = this.down; this.down = d;
    this.wheel = this.mouse.wheel; this.mouse.wheel = 0;
  }
  pressed(n) { return this.down[n] && !this.prev[n]; }
  held(n) { return !!this.down[n]; }
}
