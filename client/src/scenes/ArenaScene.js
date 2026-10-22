// Phaser 3 2D Side-View Platform Arena Scene: rendering, physics interpolation, animations, and particle FX
import Phaser from 'phaser';
import { ARENA, PLATFORMS, SPRINGS, PLAYER_CONFIG, EVENTS } from '../../../shared/constants.js';
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

    // Input tracking
    this.cursors = null;
    this.wasd = null;
    this.spaceKey = null;
    this.mobileJumpPressed = false;
    this.mobileDropPressed = false;
    this.lastSentInput = { x: 0, jump: false, dropDown: false };
    this.inputSendTimer = 0;
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

    // Prevent arrow keys and space from scrolling the page
    this.input.keyboard.addCapture([
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.W,
      Phaser.Input.Keyboard.KeyCodes.A,
      Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.D,
    ]);

    // 6. Setup Responsive Full-Viewport Camera (Unbounded so centerOn is pixel-exact without clamp displacement)
    this.cameras.main.useBounds = false;
    this.fitCameraToScreen();
    this.scale.on('resize', this.fitCameraToScreen, this);

    // Re-fit on window resize, DevTools device toggle, and mobile orientation change
    const handleViewportChange = () => {
      this.scale.refresh();
      this.fitCameraToScreen();
      setTimeout(() => {
        this.scale.refresh();
        this.fitCameraToScreen();
      }, 100);
      setTimeout(() => {
        this.scale.refresh();
        this.fitCameraToScreen();
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

    // 5. Match start
    this.socketClient.on(EVENTS.SERVER.GAME_STARTED, (data) => {
      this.flagHolderId = data.flagHolderId;
      soundSynth.startBGM();
      this.uiManager.showToast('🚀 MATCH STARTED! JUMP & PLATFORM TO TAG THE FLAG!', 'bonus');
    });

    // 6. Match end
    this.socketClient.on(EVENTS.SERVER.GAME_ENDED, () => {
      soundSynth.stopBGM();
      if (this.uiManager?.hidePhaseActive) {
        this.uiManager.hidePhaseActive();
      }
    });
  }

  handleSnapshot(snap) {
    this.flagHolderId = snap.f;
    this.uiManager.updateHudTimer(snap.t);

    const activeIds = new Set();

    snap.p.forEach((serverP) => {
      activeIds.add(serverP.id);
      this.serverPlayerStates.set(serverP.id, serverP);

      if (!this.playersMap.has(serverP.id)) {
        this.createPlayerVisual(serverP);
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
      this.uiManager.updateHudFlagHolder(holderVisual.name, holderVisual.colorCss);
    }
  }

  createPlayerVisual(serverP) {
    const container = this.add.container(serverP.x, serverP.y);
    container.setDepth(20);

    const colorObj = PLAYER_CONFIG.COLORS.find((c) => c.hex === serverP.colorHex) ||
                     PLAYER_CONFIG.COLORS[this.playersMap.size % PLAYER_CONFIG.COLORS.length];

    const radius = PLAYER_CONFIG.RADIUS;

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

    // Name label
    const nameText = this.add.text(0, -radius - 16, serverP.name || 'Player', {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#090d16',
      strokeThickness: 3,
      align: 'center',
    });
    nameText.setOrigin(0.5);
    container.add(nameText);

    // Score label under character
    const scoreText = this.add.text(0, radius + 10, '0', {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#94a3b8',
      stroke: '#090d16',
      strokeThickness: 2,
      align: 'center',
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
    // Resonant spring launch SFX
    soundSynth.playSpringBounce();

    // Visual compression & rebound animation of tyre pad
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
    const dt = delta / 1000;

    // 1. Process local input & transmit to server
    this.handleInput(dt);

    // 2. Interpolate player positions smoothly
    const lerpFactor = Math.min(1, dt * 24);

    for (const [id, visual] of this.playersMap.entries()) {
      const serverP = this.serverPlayerStates.get(id);
      if (serverP) {
        // For the local player, snap to server position to prevent desync/floating
        const isLocalPlayer = (id === this.myId);

        if (isLocalPlayer) {
          // Directly apply server position with minimal smoothing
          visual.container.x = serverP.x;
          visual.container.y = serverP.y;
        } else {
          // Smooth interpolation for remote players
          visual.container.x = Phaser.Math.Linear(visual.container.x, serverP.x, lerpFactor);
          visual.container.y = Phaser.Math.Linear(visual.container.y, serverP.y, lerpFactor);
        }

        visual.scoreText.setText(serverP.s);

        // Orient eyes toward velocity
        if (Math.abs(serverP.vx) > 10) {
          visual.eyeG.x = Math.sign(serverP.vx) * 4;
        }

        // Squash & stretch based on jumping/grounded state
        if (!serverP.g) {
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
    const pulseRadius = PLAYER_CONFIG.RADIUS + 8 + Math.sin(time / 150) * 4;
    this.flagGlowRing.lineStyle(3, 0xf59e0b, 0.85);
    this.flagGlowRing.strokeCircle(hx, hy, pulseRadius);
    this.flagGlowRing.fillStyle(0xf59e0b, 0.15);
    this.flagGlowRing.fillCircle(hx, hy, pulseRadius);
  }

  handleInput(dt) {
    let ix = 0;
    let jump = false;
    let dropDown = false;

    // Desktop keyboard input
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

    // Mobile Virtual Joystick input
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

    // Sound effect on local jump initiation
    if (jump && !this.lastSentInput.jump) {
      soundSynth.playJump();
    }

    // Send input to server at 30 Hz or immediately on state change
    this.inputSendTimer += dt;
    const inputChanged =
      Math.abs(ix - this.lastSentInput.x) > 0.02 ||
      jump !== this.lastSentInput.jump ||
      dropDown !== this.lastSentInput.dropDown;

    if (inputChanged || this.inputSendTimer >= 1 / 30) {
      this.lastSentInput = { x: ix, jump, dropDown };
      this.inputSendTimer = 0;
      this.socketClient.sendInput(ix, 0, jump, dropDown);
    }
  }
}
