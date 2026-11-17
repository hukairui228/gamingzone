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
    if (this.isTouch) this.buildTouch();
  }

  buildTouch() {
    const ui = document.createElement('div');
    ui.id = 'touch';
    ui.innerHTML = `
      <div class="stick" id="stick"><div class="knob"></div></div>
      <div class="tbtns">
        <button data-b="fire">开火</button><button data-b="jump">跳</button>
        <button data-b="enter">上车</button><button data-b="sprint">冲刺</button>
        <button data-b="handbrake">手刹</button><button data-b="weapon">武器</button>
      </div>`;
    document.body.appendChild(ui);
    const stick = ui.querySelector('#stick'), knob = stick.querySelector('.knob');
    let sid = null, sx = 0, sy = 0, lid = null, lx = 0, ly = 0;
    addEventListener('touchstart', (e) => {
      for (const t of e.changedTouches) {
        const b = t.target.closest?.('button[data-b]');
        if (b) { this.touch.buttons.add(b.dataset.b); this.touch.tapped.add(b.dataset.b); continue; }
        if (t.clientX < innerWidth * 0.45 && sid === null) { sid = t.identifier; sx = t.clientX; sy = t.clientY; stick.style.left = sx - 60 + 'px'; stick.style.top = sy - 60 + 'px'; stick.classList.add('on'); }
        else if (lid === null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === sid) {
          let dx = (t.clientX - sx) / 50, dy = (t.clientY - sy) / 50;
          const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
          this.touch.move.x = dx; this.touch.move.y = dy;
          knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
        } else if (t.identifier === lid) {
          this.touch.look.dx += (t.clientX - lx) * 1.5; this.touch.look.dy += (t.clientY - ly) * 1.5; lx = t.clientX; ly = t.clientY;
        }
      }
    }, { passive: true });
    const end = (e) => {
      for (const t of e.changedTouches) {
        const b = t.target.closest?.('button[data-b]');
        if (b) this.touch.buttons.delete(b.dataset.b);
        if (t.identifier === sid) { sid = null; this.touch.move.x = this.touch.move.y = 0; knob.style.transform = ''; stick.classList.remove('on'); }
        if (t.identifier === lid) lid = null;
      }
    };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  /** Normalised controls for this frame. */
  state() {
    const t = this.touch;
    const s = {
      x: (this.down('KeyD', 'ArrowRight') ? 1 : 0) - (this.down('KeyA', 'ArrowLeft') ? 1 : 0) + t.move.x,
      y: (this.down('KeyW', 'ArrowUp') ? 1 : 0) - (this.down('KeyS', 'ArrowDown') ? 1 : 0) - t.move.y,
      lookX: this.mouse.dx + t.look.dx, lookY: this.mouse.dy + t.look.dy,
      fire: this.mouse.down || t.buttons.has('fire') || this.down('KeyJ'),
      aim: this.mouse.right,
      sprint: this.down('ShiftLeft', 'ShiftRight') || t.buttons.has('sprint'),
      handbrake: this.down('Space') || t.buttons.has('handbrake'),
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
