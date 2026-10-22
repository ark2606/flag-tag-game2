// Mobile Touch Virtual Joystick Controller
export class VirtualJoystick {
  constructor(zoneElement, baseElement, thumbElement) {
    this.zone = zoneElement;
    this.base = baseElement;
    this.thumb = thumbElement;

    this.active = false;
    this.touchId = null;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.maxRadius = 45; // pixels of movement

    this.vector = { x: 0, y: 0 };

    this.initTouchListeners();
  }

  initTouchListeners() {
    if (!this.zone || !this.thumb) return;

    // Show joystick on touch devices or when mobile viewport is simulated in devtools
    const checkVisibility = () => {
      const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
      const isMobileLayout = window.innerHeight <= 600 || window.innerWidth <= 1024;
      if (isTouch || isMobileLayout) {
        this.zone.style.display = 'block';
      }
    };
    checkVisibility();
    window.addEventListener('resize', checkVisibility);
    window.addEventListener('orientationchange', checkVisibility);

    const onStart = (e) => {
      if (e.cancelable) e.preventDefault();
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      this.active = true;
      this.touchId = touch.identifier !== undefined ? touch.identifier : null;

      const rect = this.base.getBoundingClientRect();
      this.startX = rect.left + rect.width / 2;
      this.startY = rect.top + rect.height / 2;

      this.updateFromPosition(touch.clientX, touch.clientY);
    };

    const onMove = (e) => {
      if (!this.active) return;
      if (e.cancelable) e.preventDefault();
      let touch = null;
      if (e.changedTouches) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this.touchId) {
            touch = e.changedTouches[i];
            break;
          }
        }
      } else {
        touch = e;
      }

      if (touch) {
        this.updateFromPosition(touch.clientX, touch.clientY);
      }
    };

    const onEnd = (e) => {
      if (!this.active) return;
      // If this was a touch event, only end if the released touch matches this joystick's touchId!
      if (e.changedTouches && this.touchId !== null) {
        let matching = false;
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this.touchId) {
            matching = true;
            break;
          }
        }
        if (!matching) {
          // Another finger ended (e.g. Jump button release) - do NOT interrupt joystick movement!
          return;
        }
      }

      this.active = false;
      this.touchId = null;
      this.vector = { x: 0, y: 0 };
      this.thumb.style.transform = `translate(-50%, -50%)`;
    };

    this.zone.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: false });
    window.addEventListener('touchcancel', onEnd, { passive: false });

    // Also support mouse dragging on the joystick for testing in browser devtools
    this.zone.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  }

  updateFromPosition(clientX, clientY) {
    const dx = clientX - this.startX;
    const dy = clientY - this.startY;
    const dist = Math.hypot(dx, dy);

    let normX = 0;
    let normY = 0;

    if (dist > 0.001) {
      const clampedDist = Math.min(dist, this.maxRadius);
      const angle = Math.atan2(dy, dx);

      const thumbX = Math.cos(angle) * clampedDist;
      const thumbY = Math.sin(angle) * clampedDist;

      this.thumb.style.transform = `translate(calc(-50% + ${thumbX}px), calc(-50% + ${thumbY}px))`;

      normX = thumbX / this.maxRadius;
      normY = thumbY / this.maxRadius;
    } else {
      this.thumb.style.transform = `translate(-50%, -50%)`;
    }

    this.vector = { x: normX, y: normY };
  }

  getInput() {
    return this.vector;
  }
}
