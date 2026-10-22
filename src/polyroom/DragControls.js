/*
 * DragControls
 * ------------
 * Real-time mouse / touch camera control for a PolyRoom, built only on the room's public API
 * (getCamera, setCamera, commitStep, lockInteraction). Create one per room with its own limits.
 *
 *   new DragControls(room, {
 *     axis: 'horizontal',            // 'horizontal' | 'vertical' | 'both'
 *     yawLimit: [-40, 40],           // degrees from the current wall, or null = unlimited
 *     pitchLimit: [-30, 30],         // degrees (ignored for axis 'horizontal')
 *     zoomLimit: [1, 2],             // [min, max] enables wheel + pinch zoom; null = no zoom
 *     release: 'snap',               // 'free' | 'spring' | 'snap'
 *   });
 *
 * release:
 *   free   – camera stays where you dropped it; the nearest wall becomes the current wall.
 *   spring – eases back to the centre of the current wall.
 *   snap   – turns to the nearest wall (a quick flick goes to the next/previous one).
 *
 * Mark elements that must not start a drag (sliders, custom canvases...) with data-room-no-drag.
 * Events: 'dragstart', 'drag', 'dragend'.
 */

const clamp = (v, lim) => (lim ? Math.min(lim[1], Math.max(lim[0], v)) : v);

export class DragControls extends EventTarget {
  constructor(room, opts = {}) {
    super();
    this.room = room;
    this.o = {
      axis: 'both',
      yawLimit: null,
      pitchLimit: [-60, 60],
      zoomLimit: null,
      wheelZoom: true,
      pinchZoom: true,
      sensitivity: 1,        // 1 = the scene follows the finger 1:1 at screen centre
      release: 'free',
      releaseDuration: 0.7,
      threshold: 6,          // px before a press becomes a drag (keeps clicks working)
      flickSpeed: 0.6,       // px/ms for snap-mode flicks
      filter: null,          // (pointerEvent) => boolean, return false to ignore a press
      ...opts,
    };
    this.enabled = true;
    this._pointers = new Map();
    this._p = null;          // primary drag state
    this._pinch = null;
    this._active = false;
    this._suppressClick = false;

    const root = room.root;
    root.classList.add('is-draggable');
    this._prevTouchAction = root.style.touchAction;
    const { axis, zoomLimit, pinchZoom } = this.o;
    root.style.touchAction =
      zoomLimit && pinchZoom ? 'none' : axis === 'horizontal' ? 'pan-y' : axis === 'vertical' ? 'pan-x' : 'none';

    this._onDown = this._down.bind(this);
    this._onMove = this._move.bind(this);
    this._onUp = this._up.bind(this);
    this._onWheel = this._wheel.bind(this);
    this._onClick = (e) => {
      if (this._suppressClick) { e.stopPropagation(); e.preventDefault(); this._suppressClick = false; }
    };
    root.addEventListener('pointerdown', this._onDown);
    root.addEventListener('pointermove', this._onMove);
    root.addEventListener('pointerup', this._onUp);
    root.addEventListener('pointercancel', this._onUp);
    root.addEventListener('wheel', this._onWheel, { passive: false });
    root.addEventListener('click', this._onClick, true);
  }

  destroy() {
    const root = this.room.root;
    root.removeEventListener('pointerdown', this._onDown);
    root.removeEventListener('pointermove', this._onMove);
    root.removeEventListener('pointerup', this._onUp);
    root.removeEventListener('pointercancel', this._onUp);
    root.removeEventListener('wheel', this._onWheel);
    root.removeEventListener('click', this._onClick, true);
    root.style.touchAction = this._prevTouchAction;
    root.classList.remove('is-draggable', 'is-dragging');
    if (this._active) this.room.lockInteraction(false);
  }

  // degrees of camera rotation per screen pixel at the centre of the view
  _degPerPx() {
    const { a } = this.room;
    const zoom = Math.max(0.01, this.room.view.zoom);
    return ((180 / Math.PI) * (1 / (a * zoom))) * this.o.sensitivity;
  }

  _begin() {
    if (this._active) return;
    this._active = true;
    this.room.lockInteraction(true);
    this.room.root.classList.add('is-dragging');
    this.dispatchEvent(new CustomEvent('dragstart'));
  }

  _down(e) {
    if (!this.enabled || this.room.isMoving) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest?.('[data-room-no-drag]')) return;
    if (this.o.filter && !this.o.filter(e)) return;

    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._pointers.size === 1) {
      this._p = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(), vx: 0, moved: false };
    } else if (this._pointers.size === 2 && this.o.zoomLimit && this.o.pinchZoom) {
      const [p1, p2] = [...this._pointers.values()];
      this._pinch = { d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), z0: this.room.view.zoom };
      this._p = null;
      this._begin();
    } else {
      this._p = null;
    }
  }

  _move(e) {
    const pt = this._pointers.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX;
    pt.y = e.clientY;

    // pinch zoom
    if (this._pinch && this._pointers.size === 2) {
      const [p1, p2] = [...this._pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const zoom = clamp(this._pinch.z0 * (d / this._pinch.d0), this.o.zoomLimit);
      this.room.setCamera({ zoom }, { duration: 0 });
      this.dispatchEvent(new CustomEvent('drag'));
      return;
    }

    const p = this._p;
    if (!p || p.id !== e.pointerId) return;

    if (!p.moved) {
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < this.o.threshold) return;
      p.moved = true;
      p.lx = e.clientX; p.ly = e.clientY; // start from here, no jump
      this._begin();
      try { this.room.root.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }

    const now = performance.now();
    const dx = e.clientX - p.lx;
    const dy = e.clientY - p.ly;
    const dt = Math.max(1, now - p.lt);
    p.vx = p.vx * 0.6 + (dx / dt) * 0.4;
    p.lx = e.clientX; p.ly = e.clientY; p.lt = now;

    const k = this._degPerPx();
    const v = this.room.getCamera();
    let { yaw, pitch } = v;
    if (this.o.axis !== 'vertical') yaw = clamp(yaw + dx * k, this.o.yawLimit);
    if (this.o.axis !== 'horizontal') pitch = clamp(pitch + dy * k, this.o.pitchLimit);
    this.room.setCamera({ yaw, pitch }, { duration: 0 });
    this.dispatchEvent(new CustomEvent('drag', { detail: { yaw, pitch } }));
  }

  _up(e) {
    if (!this._pointers.has(e.pointerId)) return;
    const p = this._p;
    this._pointers.delete(e.pointerId);
    try { this.room.root.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (this._pointers.size > 0) return; // wait until every finger is up

    const wasActive = this._active;
    this._p = null;
    this._pinch = null;
    if (!wasActive) return; // it was just a click/tap

    this._active = false;
    this._suppressClick = true;
    setTimeout(() => { this._suppressClick = false; }, 0);
    this.room.root.classList.remove('is-dragging');
    this.room.lockInteraction(false);
    this._release(p);
    this.dispatchEvent(new CustomEvent('dragend'));
  }

  _release(p) {
    const room = this.room;
    const dur = this.o.releaseDuration;
    switch (this.o.release) {
      case 'spring':
        room.setCamera({ yaw: 0, pitch: 0 }, { duration: dur });
        break;
      case 'snap': {
        let s = room.nearestStep();
        if (p && this.o.axis !== 'vertical' && Math.abs(p.vx) > this.o.flickSpeed && s === room.step) {
          s = room.step + (p.vx < 0 ? 1 : -1);
        }
        room.commitStep(s);
        room.setCamera({ yaw: 0, pitch: 0 }, { duration: dur });
        break;
      }
      default: // free
        room.commitStep(room.nearestStep());
    }
  }

  _wheel(e) {
    const { zoomLimit, wheelZoom } = this.o;
    if (!this.enabled || !zoomLimit || !wheelZoom) return;
    e.preventDefault();
    const zoom = clamp(this.room.view.zoom * Math.exp(-e.deltaY * 0.0015), zoomLimit);
    this.room.setCamera({ zoom }, { duration: 0 });
  }
}
