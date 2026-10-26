// Phaser 3 2D Side-View Platform Arena Scene: rendering, physics interpolation, animations, and particle FX
import Phaser from 'phaser';
import { ARENA, PLATFORMS, SPRINGS, PLAYER_CONFIG, PHYSICS_CONFIG, EVENTS } from '../../../shared/constants.js';
import { soundSynth } from '../ui/soundSynth.js';

export class ArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ArenaScene' });
    this.socketClient = null;
    this.virtualJoystick = null;
    this.uiManager = null;

    this.myId = null;
    this.playersMap = new Map(); // socketId -> visual container
    this.serverPlayerStates = new Map(); // socketId -> latest target snapshot
    this.flagHolderId = null;

    // Visual elements
    this.springGraphics = new Map(); // springId -> container
    this.flagContainer = null;
    this.flagGlowRing = null;
    this.isFlagSurgeActive = false;

    // Input tracking (Keyboard, Pointer / Mouse Among Us style, and Touch)
    this.cursors = null;
    this.wasd = null;
    this.spaceKey = null;
    this.pointerIsDown = false;
    this.pointerWorldX = 0;
    this.pointerWorldY = 0;
    this.mobileJumpPressed = false;
    this.mobileDropPressed = false;
    this.lastSentInput = { x: 0, jump: false, dropDown: false };
    this.inputSendTimer = 0;

    // Responsive local player prediction
    this.localPredictedPos = null;
    this.currentInputX = 0;
    this.currentJumpRequested = false;
    this.currentDropDown = false;
    this.localSpringCooldown = 0;
    this.effectiveSpeed = 440;
    this.isMatchPlaying = false;
  }

  init(data = {}) {
    if (data.socketClient) this.socketClient = data.socketClient;
    if (data.virtualJoystick) this.virtualJoystick = data.virtualJoystick;
    if (data.uiManager) this.uiManager = data.uiManager;
    if (data.myId !== undefined) this.myId = data.myId;
  }

  create() {
    // 1. Draw 2D Side-View Platform Scenery & Backdrop
    this.drawSceneryBackground();

    // 2. Draw Platforms (Ground, Wood, Stone, Suspension)
    this.drawPlatforms();

    // 3. Draw Spring Pads / Tyre Launchers
    this.drawSpringPads();

    // 4. Create Flag Visual Object
    this.createFlagVisuals();

    // 5. Setup Keyboard Controls
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Prevent arrow keys from scrolling the page during active gameplay.
    // NEVER capture letter keys (W, A, S, D) or Space globally so users can freely type in HTML inputs!
    this.input.keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
    ]);

    // When typing in text inputs (e.g. nickname, room code), disable Phaser keyboard capture completely
    const isTextInput = (target) => {
      if (!target) return false;
      const tag = target.tagName ? target.tagName.toUpperCase() : '';
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };

    window.addEventListener('focusin', (e) => {
      if (isTextInput(e.target) && this.input?.keyboard) {
        this.input.keyboard.enabled = false;
        if (this.input.keyboard.manager) {
          this.input.keyboard.manager.enabled = false;
        }
      }
    }, true);

    window.addEventListener('focusout', (e) => {
      if (isTextInput(e.target) && this.input?.keyboard) {
        this.input.keyboard.enabled = true;
        if (this.input.keyboard.manager) {
          this.input.keyboard.manager.enabled = true;
        }
      }
    }, true);

    // 6. Setup Responsive Full-Viewport Camera (Unbounded so centerOn is pixel-exact without clamp displacement)
    this.cameras.main.useBounds = false;
    this.fitCameraToScreen();
    this.scale.on('resize', this.fitCameraToScreen, this);

    // Re-fit on window resize, DevTools device toggle, and mobile orientation change
    const handleViewportChange = () => {
      const app = window.__gameApp;
      if (app && typeof app.resizeGame === 'function') {
        app.resizeGame();
      } else {
        this.scale.refresh();
        this.fitCameraToScreen();
      }
      setTimeout(() => {
        const a = window.__gameApp;
        if (a && typeof a.resizeGame === 'function') {
          a.resizeGame();
        } else {
          this.scale.refresh();
          this.fitCameraToScreen();
        }
      }, 100);
      setTimeout(() => {
        const a = window.__gameApp;
        if (a && typeof a.resizeGame === 'function') {
          a.resizeGame();
        } else {
          this.scale.refresh();
          this.fitCameraToScreen();
        }
      }, 350);
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    if (screen.orientation) {
      screen.orientation.addEventListener('change', handleViewportChange);
    }

    // 7. Hook Network Events
    this.setupNetworkHooks();

    // 8. Bind Mobile Jump and Drop Buttons if present in DOM
    const mobileJumpBtn = document.getElementById('mobile-jump-btn');
    if (mobileJumpBtn) {
      const setJump = (e) => {
        if (e.cancelable) e.preventDefault();
        this.mobileJumpPressed = true;
      };
      const clearJump = (e) => {
        if (e.cancelable) e.preventDefault();
        this.mobileJumpPressed = false;
      };
      mobileJumpBtn.addEventListener('pointerdown', setJump);
      mobileJumpBtn.addEventListener('pointerup', clearJump);
      mobileJumpBtn.addEventListener('pointercancel', clearJump);
      mobileJumpBtn.addEventListener('pointerleave', clearJump);
    }

    const mobileDropBtn = document.getElementById('mobile-drop-btn');
    if (mobileDropBtn) {
      const setDrop = (e) => {
        if (e.cancelable) e.preventDefault();
        this.mobileDropPressed = true;
      };
      const clearDrop = (e) => {
        if (e.cancelable) e.preventDefault();
        this.mobileDropPressed = false;
      };
      mobileDropBtn.addEventListener('pointerdown', setDrop);
      mobileDropBtn.addEventListener('pointerup', clearDrop);
      mobileDropBtn.addEventListener('pointercancel', clearDrop);
      mobileDropBtn.addEventListener('pointerleave', clearDrop);
    }

    // 9. Pointer / Mouse Click-and-Drag Controls (Immediate reaction, Among Us style)
    this.input.on('pointerdown', (pointer) => {
      this.pointerIsDown = true;
      this.pointerWorldX = pointer.worldX;
      this.pointerWorldY = pointer.worldY;
      this.showClickEffect(pointer.worldX, pointer.worldY);
    });

    this.input.on('pointermove', (pointer) => {
      if (this.pointerIsDown) {
        this.pointerWorldX = pointer.worldX;
        this.pointerWorldY = pointer.worldY;
      }
    });

    this.input.on('pointerup', () => {
      this.pointerIsDown = false;
    });

    this.input.on('pointercancel', () => {
      this.pointerIsDown = false;
    });
  }

  showClickEffect(x, y) {
    const marker = this.add.graphics();
    marker.setPosition(x, y);
    marker.lineStyle(2, 0x38bdf8, 0.9);
    marker.strokeCircle(0, 0, 18);
    marker.fillStyle(0x38bdf8, 0.25);
    marker.fillCircle(0, 0, 18);
    marker.setDepth(50);
    this.tweens.add({
      targets: marker,
      scaleX: 0.3,
      scaleY: 0.3,
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => marker.destroy(),
    });
  }

  fitCameraToScreen() {
    const width = this.scale.width;
    const height = this.scale.height;
    if (!width || !height) return;

    // Uniform aspect-ratio scaling: preserves exact geometry without stretching
    // Fits the arena into the available screen, centered like on a laptop!
    const zoom = Math.min(width / ARENA.WIDTH, height / ARENA.HEIGHT);

    this.cameras.main.useBounds = false;
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(ARENA.WIDTH / 2, ARENA.HEIGHT / 2);
  }

  drawSceneryBackground() {
    // 1. Atmospheric Sky Backdrop (covers ultra-wide landscape and varied aspect ratios)
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x070b14, 0x070b14, 0x1e1b4b, 0x0f172a, 1);
    bg.fillRect(-1200, -800, ARENA.WIDTH + 2400, ARENA.HEIGHT + 1600);

    // 2. Distant mountain silhouettes
    const mountains = this.add.graphics();
    mountains.fillStyle(0x0f172a, 0.7);
    mountains.beginPath();
    mountains.moveTo(-1200, 940);
    mountains.lineTo(-600, 520);
    mountains.lineTo(-200, 800);
    mountains.lineTo(100, 480);
    mountains.lineTo(350, 700);
    mountains.lineTo(600, 380);
    mountains.lineTo(900, 680);
    mountains.lineTo(1200, 420);
    mountains.lineTo(1500, 720);
    mountains.lineTo(1800, 500);
    mountains.lineTo(2200, 680);
    mountains.lineTo(ARENA.WIDTH + 1200, 940);
    mountains.closePath();
    mountains.fillPath();

    // Midground hills
    mountains.fillStyle(0x131f37, 0.85);
    mountains.beginPath();
    mountains.moveTo(-1200, 940);
    mountains.lineTo(-500, 680);
    mountains.lineTo(-200, 850);
    mountains.lineTo(250, 620);
    mountains.lineTo(500, 800);
    mountains.lineTo(800, 560);
    mountains.lineTo(1100, 780);
    mountains.lineTo(1450, 600);
    mountains.lineTo(1800, 780);
    mountains.lineTo(2100, 640);
    mountains.lineTo(ARENA.WIDTH + 1200, 940);
    mountains.closePath();
    mountains.fillPath();

    // Starfield specks across expanded arena sky
    const stars = this.add.graphics();
    stars.fillStyle(0xffffff, 0.6);
    for (let i = 0; i < 140; i++) {
      const sx = ((i * 179 + 43) % (ARENA.WIDTH + 1200)) - 600;
      const sy = (i * 83 + 27) % 550;
      stars.fillCircle(sx, sy, (i % 3 === 0) ? 1.5 : 1);
    }

    // 3. Arena Outer Boundary Outlines
    const wallG = this.add.graphics();
    const wt = ARENA.WALL_THICKNESS;

    // Glowing cyan arena boundary lines
    wallG.lineStyle(3, 0x06b6d4, 0.5);
    wallG.strokeRect(wt / 2, wt / 2, ARENA.WIDTH - wt, ARENA.HEIGHT - wt);

    // Dark solid border walls
    wallG.fillStyle(0x090d16, 1);
    wallG.fillRect(0, 0, ARENA.WIDTH, wt); // Ceiling
    wallG.fillRect(0, 0, wt, ARENA.HEIGHT); // Left
    wallG.fillRect(ARENA.WIDTH - wt, 0, wt, ARENA.HEIGHT); // Right
  }

  drawPlatforms() {
    const g = this.add.graphics();

    for (const plat of PLATFORMS) {
      if (plat.type === 'ground') {
        // Continuous bedrock ground floor
        g.fillStyle(0x0f172a, 1);
        g.fillRect(plat.x, plat.y, plat.width, plat.height);

        // Neon cyan hazard boundary strip along top of ground
        g.fillStyle(0x06b6d4, 1);
        g.fillRect(plat.x, plat.y, plat.width, 4);

        // Subsurface foundation detail
        g.fillStyle(0x1e293b, 1);
        g.fillRect(plat.x, plat.y + 4, plat.width, plat.height - 4);
      } else if (plat.type === 'stone') {
        // High-tech slate stone platform
        g.fillStyle(0x1e293b, 1);
        g.fillRoundedRect(plat.x, plat.y, plat.width, plat.height, 6);

        // Top landing surface highlight
        g.fillStyle(0x38bdf8, 0.9);
        g.fillRoundedRect(plat.x + 2, plat.y, plat.width - 4, 3, 2);

        // Inner beveled core
        g.fillStyle(0x334155, 0.7);
        g.fillRoundedRect(plat.x + 4, plat.y + 4, plat.width - 8, plat.height - 7, 4);
      } else if (plat.type === 'wood') {
        // Warm wooden bridge planks
        g.fillStyle(0x78350f, 1);
        g.fillRoundedRect(plat.x, plat.y, plat.width, plat.height, 5);

        // Golden amber landing surface
        g.fillStyle(0xf59e0b, 0.85);
        g.fillRoundedRect(plat.x + 2, plat.y, plat.width - 4, 3, 2);

        // Plank divisions
        g.lineStyle(1.5, 0x451a03, 0.8);
        const step = 40;
        for (let px = plat.x + step; px < plat.x + plat.width; px += step) {
          g.lineBetween(px, plat.y + 3, px, plat.y + plat.height - 2);
        }
      } else if (plat.type === 'suspension') {
        // Suspended wire bridge with vertical support cables
        g.lineStyle(1.5, 0x64748b, 0.4);
        g.lineBetween(plat.x + 20, 0, plat.x + 20, plat.y);
        g.lineBetween(plat.x + plat.width - 20, 0, plat.x + plat.width - 20, plat.y);

        // Bridge walkway
        g.fillStyle(0x1e293b, 1);
        g.fillRoundedRect(plat.x, plat.y, plat.width, plat.height, 4);

        // Glowing emerald accent strip
        g.fillStyle(0x10b981, 0.85);
        g.fillRoundedRect(plat.x + 2, plat.y, plat.width - 4, 3, 2);
      }
    }
  }

  drawSpringPads() {
    for (const spring of SPRINGS) {
      const container = this.add.container(spring.x + spring.width / 2, spring.y + spring.height / 2);
      container.setDepth(14);

      const w = spring.width;
      const h = spring.height;

      // Base tyre launcher graphics
      const baseG = this.add.graphics();

      // Outer heavy-duty rubber tyre chassis
      baseG.fillStyle(0x0f172a, 1);
      baseG.fillRoundedRect(-w / 2, -h / 2 + 2, w, h - 2, 7);
      baseG.lineStyle(2, 0x334155, 1);
      baseG.strokeRoundedRect(-w / 2, -h / 2 + 2, w, h - 2, 7);

      // Tyre tread grooves
      baseG.fillStyle(0x1e293b, 1);
      const treadStep = 18;
      for (let tx = -w / 2 + 10; tx < w / 2 - 6; tx += treadStep) {
        baseG.fillRect(tx, -h / 2 + 6, 6, h - 8);
      }

      // High-energy inner core glow
      baseG.fillStyle(0xf59e0b, 0.35);
      baseG.fillRoundedRect(-w / 2 + 8, -h / 2 + 4, w - 16, h - 8, 4);

      // Upward launch chevron indicators (▲ ▲ ▲)
      baseG.fillStyle(0xfef08a, 0.95);
      [-w / 4, 0, w / 4].forEach((cx) => {
        baseG.beginPath();
        baseG.moveTo(cx, -h / 2 + 4);
        baseG.lineTo(cx + 6, -h / 2 + 12);
        baseG.lineTo(cx - 6, -h / 2 + 12);
        baseG.closePath();
        baseG.fillPath();
      });

      // Spring launch plate on top
      const plate = this.add.graphics();
      plate.fillStyle(0xf59e0b, 1);
      plate.fillRoundedRect(-w / 2, -h / 2, w, 6, 3);
      plate.lineStyle(2, 0xffedd5, 1);
      plate.strokeRoundedRect(-w / 2, -h / 2, w, 6, 3);

      container.add(baseG);
      container.add(plate);

      this.springGraphics.set(spring.id, { container, plate });
    }
  }

  createFlagVisuals() {
    // Pulsing aura ring behind flag holder
    this.flagGlowRing = this.add.graphics();
    this.flagGlowRing.setDepth(18);
    this.flagGlowRing.setVisible(false);

    // Floating flag container
    this.flagContainer = this.add.container(0, 0);
    this.flagContainer.setDepth(32);
    this.flagContainer.setVisible(false);

    const flagG = this.add.graphics();
    // Flag pole
    flagG.lineStyle(3, 0xffffff, 1);
    flagG.lineBetween(0, 0, 0, -34);

    // Golden flag banner cloth
    flagG.fillStyle(0xf59e0b, 1);
    flagG.beginPath();
    flagG.moveTo(0, -34);
    flagG.lineTo(26, -25);
    flagG.lineTo(0, -16);
    flagG.closePath();
    flagG.fillPath();

    flagG.lineStyle(1.5, 0xffedd5, 1);
    flagG.strokePath();

    this.flagContainer.add(flagG);

    // Smooth bobbing tween
    this.tweens.add({
      targets: this.flagContainer,
      y: '-=6',
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  setupNetworkHooks() {
    if (!this.socketClient) {
      console.warn('ArenaScene: socketClient is not ready yet');
      return;
    }

    // 1. Snapshot state
    this.socketClient.on(EVENTS.SERVER.GAME_SNAPSHOT, (snap) => {
      this.handleSnapshot(snap);
    });

    // 2. Flag transferred
    this.socketClient.on(EVENTS.SERVER.FLAG_TRANSFERRED, (data) => {
      this.onFlagTransferred(data);
    });

    // 3. Spring launcher triggered
    this.socketClient.on(EVENTS.SERVER.SPRING_TRIGGERED, (data) => {
      this.onSpringTriggered(data);
    });

    // 4. Dynamic scoring phases
    this.socketClient.on(EVENTS.SERVER.PHASE_WARNING, (data) => {
      soundSynth.playPhaseWarning();
      if (this.uiManager?.showPhaseWarning) {
        this.uiManager.showPhaseWarning(data);
      }
    });

    this.socketClient.on(EVENTS.SERVER.PHASE_STARTED, (data) => {
      soundSynth.playPhaseStart();
      if (this.uiManager?.showPhaseActive) {
        this.uiManager.showPhaseActive(data);
      }
    });

    this.socketClient.on(EVENTS.SERVER.PHASE_ENDED, () => {
      if (this.uiManager?.hidePhaseActive) {
        this.uiManager.hidePhaseActive();
      }
    });

    // 5. Golden Flag Surge events (secret gaining twist)
    this.socketClient.on(EVENTS.SERVER.FLAG_SURGE_STARTED, (data) => {
      this.isFlagSurgeActive = true;
      soundSynth.playSurgeStart();
      if (this.uiManager?.showSurgeActive) {
        this.uiManager.showSurgeActive(data);
      }
    });

    this.socketClient.on(EVENTS.SERVER.FLAG_SURGE_ENDED, () => {
      this.isFlagSurgeActive = false;
      soundSynth.playSurgeEnd();
      if (this.uiManager?.showSurgeEnded) {
        this.uiManager.showSurgeEnded();
      }
    });

    // Speed update listener
    this.socketClient.on(EVENTS.SERVER.SPEED_UPDATED, (data) => {
      this.effectiveSpeed = data.effectiveSpeed || data.baseSpeed || 440;
    });

    // Room state listener (reset prediction when leaving/resetting match)
    this.socketClient.on(EVENTS.SERVER.ROOM_STATE, (room) => {
      if (room.status !== 'playing') {
        this.isMatchPlaying = false;
        this.localPredictedPos = null;
        this.isFlagSurgeActive = false;
      }
    });

    // 6. Match start
    this.socketClient.on(EVENTS.SERVER.GAME_STARTED, (data) => {
      this.flagHolderId = data.flagHolderId;
      this.isMatchPlaying = true;
      this.isFlagSurgeActive = false;
      if (data.effectiveSpeed) {
        this.effectiveSpeed = data.effectiveSpeed;
      }
      soundSynth.startBGM();
      this.uiManager.showToast('MATCH STARTED: TAG THE FLAG HOLDER', 'bonus');
    });

    // 7. Match end
    this.socketClient.on(EVENTS.SERVER.GAME_ENDED, () => {
      this.isMatchPlaying = false;
      this.isFlagSurgeActive = false;
      this.localPredictedPos = null;
      soundSynth.stopBGM();
      if (this.uiManager?.hidePhaseActive) {
        this.uiManager.hidePhaseActive();
      }
    });
  }

  handleSnapshot(snap) {
    this.flagHolderId = snap.f;
    this.uiManager.updateHudTimer(snap.t);

    // Sync authoritative surge flag state
    if (typeof snap.sg === 'number') {
      const serverSurge = snap.sg === 1;
      if (serverSurge !== this.isFlagSurgeActive) {
        this.isFlagSurgeActive = serverSurge;
        if (serverSurge) {
          soundSynth.playSurgeStart();
          this.uiManager?.showSurgeActive();
        } else {
          soundSynth.playSurgeEnd();
          this.uiManager?.showSurgeEnded();
        }
      }
    }

    const activeIds = new Set();

    snap.p.forEach((serverP) => {
      activeIds.add(serverP.id);
      this.serverPlayerStates.set(serverP.id, serverP);

      let visual = this.playersMap.get(serverP.id);
      if (!visual) {
        this.createPlayerVisual(serverP);
      } else if (serverP.name && visual.name !== serverP.name) {
        visual.name = serverP.name;
        if (visual.nameText) {
          visual.nameText.setText(serverP.name);
        }
      }
    });

    // Clean up disconnected players
    for (const [id, visual] of this.playersMap.entries()) {
      if (!activeIds.has(id)) {
        visual.container.destroy();
        this.playersMap.delete(id);
        this.serverPlayerStates.delete(id);
      }
    }

    // Update scoreboard
    const playerArray = Array.from(this.playersMap.values()).map((v) => {
      const sp = this.serverPlayerStates.get(v.id);
      return {
        id: v.id,
        name: v.name,
        colorCss: v.colorCss,
        s: sp ? sp.s : 0,
      };
    });
    this.uiManager.updateScoreboard(playerArray, this.flagHolderId);

    // Update HUD flag holder label
    const holderVisual = this.playersMap.get(this.flagHolderId);
    if (holderVisual) {
      this.uiManager.updateHudFlagHolder(holderVisual.name, holderVisual.colorCss, this.isFlagSurgeActive);
    } else {
      this.uiManager.updateHudFlagHolder(null);
    }
  }

  createPlayerVisual(serverP) {
    const container = this.add.container(serverP.x, serverP.y);
    container.setDepth(20);

    const colorObj = PLAYER_CONFIG.COLORS.find((c) => c.hex === serverP.colorHex) ||
                     PLAYER_CONFIG.COLORS[this.playersMap.size % PLAYER_CONFIG.COLORS.length];

    const radius = PLAYER_CONFIG.RADIUS;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    // Shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillCircle(0, 4, radius);
    container.add(shadow);

    // Main body
    const body = this.add.graphics();
    body.fillStyle(colorObj.hex, 1);
    body.fillCircle(0, 0, radius);
    body.lineStyle(2.5, 0xffffff, 0.9);
    body.strokeCircle(0, 0, radius);
    container.add(body);

    // Eyes
    const eyeG = this.add.graphics();
    eyeG.fillStyle(0xffffff, 1);
    eyeG.fillCircle(-7, -4, 4);
    eyeG.fillCircle(7, -4, 4);
    eyeG.fillStyle(0x0f172a, 1);
    eyeG.fillCircle(-7, -4, 2);
    eyeG.fillCircle(7, -4, 2);
    container.add(eyeG);

    // Name label (sharp high-DPI rendering)
    const nameText = this.add.text(0, -radius - 16, serverP.name || 'Player', {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#090d16',
      strokeThickness: 3,
      align: 'center',
      resolution: dpr,
    });
    nameText.setOrigin(0.5);
    container.add(nameText);

    // Score label under character (sharp high-DPI rendering)
    const scoreText = this.add.text(0, radius + 10, '0', {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#94a3b8',
      stroke: '#090d16',
      strokeThickness: 2,
      align: 'center',
      resolution: dpr,
    });
    scoreText.setOrigin(0.5);
    container.add(scoreText);

    this.playersMap.set(serverP.id, {
      id: serverP.id,
      name: serverP.name || 'Player',
      colorCss: colorObj.css,
      colorHex: colorObj.hex,
      container,
      body,
      eyeG,
      nameText,
      scoreText,
    });
  }

  onFlagTransferred(data) {
    // Sound effect on flag transfer
    soundSynth.playPass();

    const textX = data.x || 800;
    const textY = data.y || 500;

    // Particle shockwave ring centered directly on player contact point
    const shockwave = this.add.graphics();
    shockwave.setPosition(textX, textY);
    shockwave.lineStyle(3, 0x38bdf8, 1);
    shockwave.strokeCircle(0, 0, 22);
    shockwave.setDepth(45);

    this.tweens.add({
      targets: shockwave,
      scaleX: 2.2,
      scaleY: 2.2,
      alpha: 0,
      duration: 350,
      ease: 'Quad.easeOut',
      onComplete: () => shockwave.destroy(),
    });
  }

  onSpringTriggered(data) {
    const isLocal = (data.playerId === this.myId);

    // Play spring compression animation and sound
    soundSynth.playSpringBounce();
    const springObj = this.springGraphics.get(data.springId);
    if (springObj) {
      this.tweens.add({
        targets: springObj.container,
        scaleY: 0.35,
        duration: 50,
        yoyo: true,
        ease: 'Quad.easeInOut',
      });
    }

    if (isLocal) {
      // Authoritatively ensure velocity and reset cooldown
      if (this.localPredictedPos) {
        this.localPredictedPos.vy = data.impulse;
        this.localPredictedPos.isGrounded = false;

        // If client was still near or on the floor, guarantee upward launch position
        const floorY = ARENA.GROUND_Y - PLAYER_CONFIG.RADIUS;
        if (this.localPredictedPos.y >= floorY - 6) {
          const spring = SPRINGS.find(s => s.id === data.springId);
          this.localPredictedPos.y = (spring ? spring.y : 935) - PLAYER_CONFIG.RADIUS - 6;
        }
      }
      this.localSpringCooldown = PHYSICS_CONFIG.COOLDOWN_AFTER_BOUNCE;
    }

    // Spark particles centered directly at tyre pad & player feet (does not fly off-screen)
    const p = this.playersMap.get(data.playerId);
    if (p) {
      const sparkX = p.container.x;
      const sparkY = p.container.y + PLAYER_CONFIG.RADIUS;
      const spark = this.add.graphics();
      spark.setPosition(sparkX, sparkY);
      spark.fillStyle(0xf59e0b, 0.9);
      spark.fillCircle(0, 0, 10);
      spark.setDepth(25);
      this.tweens.add({
        targets: spark,
        scaleX: 2.5,
        scaleY: 0.5,
        alpha: 0,
        duration: 250,
        onComplete: () => spark.destroy(),
      });
    }
  }

  update(time, delta) {
    // Clamp delta-time to 50ms to prevent spiral-of-death or lag-warp on background tab switch
    const dt = Math.min(delta / 1000, 0.05);

    // Cooldown decrement for spring launchers
    if (this.localSpringCooldown > 0) {
      this.localSpringCooldown -= dt;
    }

    // 1. Process local input & transmit to server
    this.handleInput(dt);

    for (const [id, visual] of this.playersMap.entries()) {
      const serverP = this.serverPlayerStates.get(id);
      if (serverP) {
        const isLocalPlayer = (id === this.myId);

        if (isLocalPlayer) {
          if (!this.localPredictedPos) {
            this.localPredictedPos = {
              x: serverP.x,
              y: serverP.y,
              vy: serverP.vy || 0,
              isGrounded: serverP.g || false,
            };
          }

          if (this.isMatchPlaying) {
            const currentSpeed = this.effectiveSpeed || 440;
            const ix = this.currentInputX || 0;

            // 1. Immediate local horizontal prediction (0ms latency response)
            this.localPredictedPos.x += ix * currentSpeed * dt;
            const minX = ARENA.WALL_THICKNESS + PLAYER_CONFIG.RADIUS;
            const maxX = ARENA.WIDTH - ARENA.WALL_THICKNESS - PLAYER_CONFIG.RADIUS;
            this.localPredictedPos.x = Math.max(minX, Math.min(maxX, this.localPredictedPos.x));

            // 2. Immediate local jump prediction
            if (this.currentJumpRequested && this.localPredictedPos.isGrounded) {
              this.localPredictedPos.vy = PHYSICS_CONFIG.JUMP_VELOCITY;
              this.localPredictedPos.isGrounded = false;
              soundSynth.playJump();
            }

            // 3. Gravitational acceleration
            this.localPredictedPos.vy = Math.min(
              PHYSICS_CONFIG.TERMINAL_VELOCITY,
              this.localPredictedPos.vy + PHYSICS_CONFIG.GRAVITY * dt
            );

            const prevY = this.localPredictedPos.y;
            let newY = prevY + this.localPredictedPos.vy * dt;

            // 4. Spring Pad / Tyre Launcher Prediction (immediate zero-lag reaction on walk-through or landing)
            let localSpringHit = null;
            if (this.localSpringCooldown <= 0) {
              const feetPrev = prevY + PLAYER_CONFIG.RADIUS;
              const feetNew = newY + PLAYER_CONFIG.RADIUS;

              for (const spring of SPRINGS) {
                const springLeft = spring.x - PLAYER_CONFIG.RADIUS * 0.8;
                const springRight = spring.x + spring.width + PLAYER_CONFIG.RADIUS * 0.8;
                const springTop = spring.y;
                const springBottom = spring.y + spring.height;

                if (this.localPredictedPos.x >= springLeft && this.localPredictedPos.x <= springRight) {
                  const downwardHit = (feetPrev <= springTop + 16 && feetNew >= springTop - 8);
                  const standingOnSpring = (feetNew >= springTop - 10 && feetNew <= springBottom + 16);

                  if (downwardHit || standingOnSpring) {
                    localSpringHit = spring;
                    break;
                  }
                }
              }

              if (localSpringHit) {
                this.localPredictedPos.vy = localSpringHit.impulse;
                newY = localSpringHit.y - PLAYER_CONFIG.RADIUS - 4;
                this.localPredictedPos.isGrounded = false;
                this.localSpringCooldown = PHYSICS_CONFIG.COOLDOWN_AFTER_BOUNCE;

                soundSynth.playSpringBounce();
                const springObj = this.springGraphics.get(localSpringHit.id);
                if (springObj) {
                  this.tweens.add({
                    targets: springObj.container,
                    scaleY: 0.35,
                    duration: 50,
                    yoyo: true,
                    ease: 'Quad.easeInOut',
                  });
                }
              }
            }

            // One-way platform landing prediction
            let groundedThisFrame = false;
            if (!localSpringHit && this.localPredictedPos.vy >= 0 && !this.currentDropDown) {
              for (const plat of PLATFORMS) {
                const platTop = plat.y;
                const feetPrev = prevY + PLAYER_CONFIG.RADIUS;
                const feetNew = newY + PLAYER_CONFIG.RADIUS;
                const withinX =
                  this.localPredictedPos.x + PLAYER_CONFIG.RADIUS * 0.5 >= plat.x &&
                  this.localPredictedPos.x - PLAYER_CONFIG.RADIUS * 0.5 <= plat.x + plat.width;

                if (feetPrev <= platTop + 4 && feetNew >= platTop && withinX) {
                  newY = platTop - PLAYER_CONFIG.RADIUS;
                  this.localPredictedPos.vy = 0;
                  groundedThisFrame = true;
                  break;
                }
              }
            }

            // Floor boundary (skip when launching from a spring or moving upward)
            if (!localSpringHit && this.localPredictedPos.vy >= 0) {
              const floorY = ARENA.GROUND_Y - PLAYER_CONFIG.RADIUS;
              if (newY >= floorY) {
                newY = floorY;
                this.localPredictedPos.vy = 0;
                groundedThisFrame = true;
              }
            }

            // Ceiling boundary
            const ceilingY = ARENA.WALL_THICKNESS + PLAYER_CONFIG.RADIUS;
            if (newY <= ceilingY) {
              newY = ceilingY;
              if (this.localPredictedPos.vy < 0) this.localPredictedPos.vy = 0;
            }

            this.localPredictedPos.y = newY;

            // Never let a lagging/stale server snapshot mark us grounded if launching upward
            if (this.localPredictedPos.vy < -20 || this.localSpringCooldown > 0) {
              this.localPredictedPos.isGrounded = false;
            } else {
              this.localPredictedPos.isGrounded = groundedThisFrame;
            }

            // Zero-Lag Client Reconciliation:
            // Do NOT drag player backward while actively moving (ix !== 0)!
            // Only reconcile horizontal drift when player is idle / releasing controls.
            const dx = serverP.x - this.localPredictedPos.x;
            const dy = serverP.y - this.localPredictedPos.y;
            const dist = Math.hypot(dx, dy);

            const inSpringLaunch = (this.localSpringCooldown > 0 || this.localPredictedPos.vy < -150 || (serverP.vy || 0) < -150);

            if (dist > 160 && !inSpringLaunch) {
              // Snap on large divergence only when NOT launching from a spring pad
              this.localPredictedPos.x = serverP.x;
              this.localPredictedPos.y = serverP.y;
              this.localPredictedPos.vy = serverP.vy || 0;
              this.localPredictedPos.isGrounded = serverP.g;
            } else {
              // Smooth exponential stationary ease: eases into server position when not moving
              if (ix === 0) {
                const reconcileRate = 1 - Math.exp(-24 * dt);
                this.localPredictedPos.x += dx * reconcileRate;
              }
              // Grounded vertical sync: keep feet aligned with surface ONLY when both agree player is grounded on same level
              if (this.localPredictedPos.isGrounded && serverP.g && !this.currentJumpRequested && Math.abs(dy) < 20 && !inSpringLaunch) {
                const reconcileY = 1 - Math.exp(-24 * dt);
                this.localPredictedPos.y += dy * reconcileY;
              }
            }

            visual.container.x = this.localPredictedPos.x;
            visual.container.y = this.localPredictedPos.y;
          } else {
            // In lobby or before start, snap directly to server position
            this.localPredictedPos.x = serverP.x;
            this.localPredictedPos.y = serverP.y;
            this.localPredictedPos.vy = serverP.vy;
            this.localPredictedPos.isGrounded = serverP.g;
            visual.container.x = serverP.x;
            visual.container.y = serverP.y;
          }
        } else {
          // Frame-rate independent exponential smoothing for remote players (ultra-smooth at 60-144 FPS)
          const dx = serverP.x - visual.container.x;
          const dy = serverP.y - visual.container.y;
          const dist = Math.hypot(dx, dy);

          if (dist > 180) {
            visual.container.x = serverP.x;
            visual.container.y = serverP.y;
          } else {
            const blend = 1 - Math.exp(-32 * dt);
            visual.container.x += dx * blend;
            visual.container.y += dy * blend;
          }
        }

        visual.scoreText.setText(serverP.s);

        // Orient eyes toward velocity (immediate local response)
        const activeVx = isLocalPlayer && this.isMatchPlaying
          ? (this.currentInputX || 0) * 100
          : serverP.vx;
        if (Math.abs(activeVx) > 10) {
          visual.eyeG.x = Math.sign(activeVx) * 4;
        }

        // Squash & stretch based on jumping/grounded state
        const isGrounded = isLocalPlayer && this.isMatchPlaying
          ? this.localPredictedPos.isGrounded
          : serverP.g;
        if (!isGrounded) {
          // Airborne stretch
          visual.body.scaleY = 1.08;
          visual.body.scaleX = 0.94;
        } else {
          // Grounded normal
          visual.body.scaleY = 1.0;
          visual.body.scaleX = 1.0;
        }
      }
    }

    // 3. Render Flag Visuals over Current Holder
    this.updateFlagPositions(time);
  }

  updateFlagPositions(time) {
    if (!this.flagHolderId || !this.playersMap.has(this.flagHolderId)) {
      this.flagContainer.setVisible(false);
      this.flagGlowRing.setVisible(false);
      return;
    }

    const holder = this.playersMap.get(this.flagHolderId);
    const hx = holder.container.x;
    const hy = holder.container.y;

    // Flag attaches right above player's head
    this.flagContainer.setVisible(true);
    this.flagContainer.x = hx;
    this.flagContainer.y = hy - PLAYER_CONFIG.RADIUS - 14;

    // Pulsing aura ring under player
    this.flagGlowRing.clear();
    this.flagGlowRing.setVisible(true);

    if (this.isFlagSurgeActive) {
      // Radiant Golden Flag Surge: intense glowing aura, faster pulse, radiant golden outer ring
      const pulseRadius = PLAYER_CONFIG.RADIUS + 12 + Math.sin(time / 80) * 5;
      this.flagGlowRing.lineStyle(4, 0xfbbf24, 0.95);
      this.flagGlowRing.strokeCircle(hx, hy, pulseRadius);
      this.flagGlowRing.lineStyle(1.5, 0xfef08a, 0.7);
      this.flagGlowRing.strokeCircle(hx, hy, pulseRadius + 6);
      this.flagGlowRing.fillStyle(0xf59e0b, 0.28);
      this.flagGlowRing.fillCircle(hx, hy, pulseRadius);

      // Occasional upward golden spark particle
      if (Math.random() < 0.25) {
        const spark = this.add.graphics();
        const sx = hx + (Math.random() - 0.5) * 36;
        const sy = hy - PLAYER_CONFIG.RADIUS - 10 + (Math.random() - 0.5) * 10;
        spark.setPosition(sx, sy);
        spark.fillStyle(0xfbbf24, 0.9);
        spark.fillCircle(0, 0, 3 + Math.random() * 2);
        spark.setDepth(45);
        this.tweens.add({
          targets: spark,
          y: sy - 35 - Math.random() * 20,
          alpha: 0,
          scaleX: 0.2,
          scaleY: 0.2,
          duration: 400,
          ease: 'Quad.easeOut',
          onComplete: () => spark.destroy(),
        });
      }
    } else {
      const pulseRadius = PLAYER_CONFIG.RADIUS + 8 + Math.sin(time / 150) * 4;
      this.flagGlowRing.lineStyle(3, 0xf59e0b, 0.85);
      this.flagGlowRing.strokeCircle(hx, hy, pulseRadius);
      this.flagGlowRing.fillStyle(0xf59e0b, 0.15);
      this.flagGlowRing.fillCircle(hx, hy, pulseRadius);
    }
  }

  handleInput(dt) {
    let ix = 0;
    let jump = false;
    let dropDown = false;

    // 1. Desktop keyboard input
    if (this.cursors.left.isDown || this.wasd.left.isDown) ix -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) ix += 1;

    // Jump: Space, W, Up Arrow, or mobile button
    if (
      this.spaceKey?.isDown ||
      this.cursors.up.isDown ||
      this.wasd.up.isDown ||
      this.mobileJumpPressed
    ) {
      jump = true;
    }

    // Drop down through platform: S, Down Arrow, or mobile drop button
    if (this.cursors.down.isDown || this.wasd.down.isDown || this.mobileDropPressed) {
      dropDown = true;
    }

    // 2. Pointer / Mouse Click-to-Move (Immediate reaction, Among Us style)
    if (this.pointerIsDown) {
      const localP = this.playersMap.get(this.myId);
      if (localP) {
        const px = this.localPredictedPos ? this.localPredictedPos.x : localP.container.x;
        const py = this.localPredictedPos ? this.localPredictedPos.y : localP.container.y;
        const dx = this.pointerWorldX - px;
        const dy = this.pointerWorldY - py;

        if (Math.abs(dx) > 18) {
          ix = Math.sign(dx);
        }
        if (dy < -45) {
          jump = true;
        } else if (dy > 45) {
          dropDown = true;
        }
      }
    }

    // 3. Mobile Virtual Joystick input
    if (this.virtualJoystick) {
      const joy = this.virtualJoystick.getInput();
      if (Math.abs(joy.x) > 0.05) {
        const sign = Math.sign(joy.x);
        const mag = Math.abs(joy.x);
        // Responsive curve: easy to hit top speed on mobile without extreme edge stretching
        ix = sign * Math.min(1, mag > 0.6 ? 1 : mag * 1.3);
      }
      if (joy.y < -0.55) {
        jump = true;
      } else if (joy.y > 0.55) {
        dropDown = true;
      }
    }

    // Save inputs for immediate local prediction in update()
    this.currentInputX = ix;
    this.currentJumpRequested = jump;
    this.currentDropDown = dropDown;

    // Send input to server at 60 Hz or immediately on state change
    this.inputSendTimer += dt;
    const inputChanged =
      Math.abs(ix - this.lastSentInput.x) > 0.02 ||
      jump !== this.lastSentInput.jump ||
      dropDown !== this.lastSentInput.dropDown;

    if (inputChanged || this.inputSendTimer >= 1 / 60) {
      this.lastSentInput = { x: ix, jump, dropDown };
      this.inputSendTimer = 0;
      this.socketClient.sendInput(ix, 0, jump, dropDown);
    }
  }
}
