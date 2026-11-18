// Keyboard + mouse + touch input, merged into one control state.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, down: false, right: false, wheel: 0 };
    this.touch = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, buttons: new Set(), tapped: new Set() };
    this.canvas = canvas;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      if (this.locked !== false && document.pointerLockElement !== canvas && !this.isTouch) canvas.requestPointerLock?.();
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    this.isTouch = matchMedia('(pointer: coarse)').matches;

  }

  /** Touch controls built from the original HUD sprites at their original screen positions. */
  buildTouch(hud) {
    const root = document.createElement('div');
    root.id = 'touch';
    document.getElementById('ui').appendChild(root);
    const T = this.touch;
    const mk = (m, x, y, a, flip = 0) => hud.mod(m, x, y, { anchor: a, flip, parent: root });
    const base = mk(1, 40, 500, 'bl'), knob = mk(0, 69, 529, 'bl');
    const button = (bg, icon, x, y, ix, iy, name, hold, flip = 0) => {
      const b = mk(bg, x, y, 'br'), i = mk(icon, ix, iy, 'br', flip);
      i.style.pointerEvents = 'none';
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); T.buttons.add(name); T.tapped.add(name); b.classList.add('pressed'); });
      const up = () => { T.buttons.delete(name); b.classList.remove('pressed'); };
      b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      return [b, i];
    };
    this.tb = {
      fire: button(3, 9, 893, 514, 912, 533, 'fire'),
      enter: button(2, 10, 904, 418, 915, 438, 'enter'),
      sprint: button(2, 11, 819, 591, 831, 602, 'sprint'),
      jump: button(2, 14, 788, 459, 807, 482, 'jump', false, 512),
      gas: [mk(17, 894, 559, 'br')], brake: [mk(16, 786, 574, 'br')],
    };
    for (const [k, el] of [['gas', this.tb.gas[0]], ['brake', this.tb.brake[0]]]) {
      el.addEventListener('pointerdown', (e) => { e.stopPropagation(); T.buttons.add(k); el.classList.add('pressed'); });
      const up = () => { T.buttons.delete(k); el.classList.remove('pressed'); };
      el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up);
    }
    hud.layout();
    let sid = null, sx = 0, sy = 0, lid = null, lx = 0, ly = 0;
    const R = 50;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      if (e.clientX < innerWidth * 0.4 && sid === null) {
        sid = e.pointerId;
        const r = base.getBoundingClientRect();
        sx = r.left + r.width / 2; sy = r.top + r.height / 2;
      } else if (lid === null) { lid = e.pointerId; lx = e.clientX; ly = e.clientY; }
    });
    addEventListener('pointermove', (e) => {
      if (e.pointerId === sid) {
        let dx = (e.clientX - sx) / R, dy = (e.clientY - sy) / R;
        const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
        T.move.x = dx; T.move.y = dy;
        knob.style.translate = `${dx * 28}px ${dy * 28}px`;
      } else if (e.pointerId === lid) {
        T.look.dx += (e.clientX - lx) * 1.4; T.look.dy += (e.clientY - ly) * 1.4; lx = e.clientX; ly = e.clientY;
      }
    });
    const end = (e) => {
      if (e.pointerId === sid) { sid = null; T.move.x = T.move.y = 0; knob.style.translate = ''; }
      if (e.pointerId === lid) lid = null;
    };
    addEventListener('pointerup', end); addEventListener('pointercancel', end);
  }

  /** show the on-foot or the driving button set */
  setTouchMode(driving) {
    if (!this.tb || this.driving === driving) return;
    this.driving = driving;
    const show = (els, on) => els.forEach((e) => { e.style.display = on ? '' : 'none'; });
    show(this.tb.fire, !driving); show(this.tb.jump, !driving);
    show(this.tb.gas, driving); show(this.tb.brake, driving);
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  /** Normalised controls for this frame. */
  state() {
    const t = this.touch;
    const s = {
      x: (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0) + t.move.x,
      y: (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0) - (this.driving ? 0 : t.move.y)
        + (t.buttons.has('gas') ? 1 : 0) - (t.buttons.has('brake') ? 1 : 0),
      lookX: this.mouse.dx + t.look.dx, lookY: this.mouse.dy + t.look.dy,
      fire: this.mouse.down || t.buttons.has('fire') || this.down('KeyJ'),
      aim: this.mouse.right,
      sprint: this.down('ShiftLeft', 'ShiftRight') || t.buttons.has('sprint'),
      handbrake: this.down('Space') || t.buttons.has('handbrake') || (this.driving && t.buttons.has('sprint')),
      jump: this.hit('Space') || t.tapped.has('jump'),
      enter: this.hit('KeyF', 'Enter') || t.tapped.has('enter'),
      weaponNext: this.hit('KeyQ', 'KeyE') || this.mouse.wheel !== 0 || t.tapped.has('weapon'),
      horn: this.down('KeyH'),
      radio: this.hit('KeyR'),
      map: this.hit('KeyM', 'Tab'),
      pause: this.hit('Escape', 'KeyP'),
      camera: this.hit('KeyC', 'KeyV'),
    };
    s.x = Math.max(-1, Math.min(1, s.x)); s.y = Math.max(-1, Math.min(1, s.y));
    return s;
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.dx = this.mouse.dy = this.mouse.wheel = 0;
    this.touch.look.dx = this.touch.look.dy = 0;
    this.touch.tapped.clear();
  }
}
