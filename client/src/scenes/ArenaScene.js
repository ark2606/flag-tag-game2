// Phaser 3 2D Arena Scene: rendering, interpolation, flag animations, and particle FX
import Phaser from 'phaser';
import { ARENA, OBSTACLES, PLAYER_CONFIG, EVENTS } from '../../../shared/constants.js';
import { soundSynth } from '../ui/soundSynth.js';

export class ArenaScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ArenaScene' });
    this.socketClient = null;
    this.virtualJoystick = null;
    this.uiManager = null;

    this.myId = null;
    this.playersMap = new Map(); // socketId -> Phaser visual container
    this.serverPlayerStates = new Map(); // socketId -> latest target snapshot
    this.flagHolderId = null;

    // Flag visual elements
    this.flagGraphic = null;
    this.flagGlowRing = null;

    // Input tracking
    this.cursors = null;
    this.wasd = null;
    this.lastSentInput = { x: 0, y: 0 };
    this.inputSendTimer = 0;
  }

  init(data) {
    this.socketClient = data.socketClient;
    this.virtualJoystick = data.virtualJoystick;
    this.uiManager = data.uiManager;
    this.myId = data.myId;
  }

  create() {
    // 1. Draw Arena Floor & Grid
    this.drawArenaEnvironment();

    // 2. Draw Obstacles
    this.drawObstacles();

    // 3. Create Shared Flag Visual Object
    this.createFlagVisuals();

    // 4. Setup Keyboard Controls
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });

    // 5. Setup Camera
    this.cameras.main.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);
    this.fitCameraToScreen();
    this.scale.on('resize', this.fitCameraToScreen, this);

    // 6. Hook Network Events
    this.setupNetworkHooks();
  }

  fitCameraToScreen() {
    const width = this.scale.width;
    const height = this.scale.height;

    const zoomX = width / ARENA.WIDTH;
    const zoomY = height / ARENA.HEIGHT;
    const zoom = Math.min(zoomX, zoomY, 1.0);

    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(ARENA.WIDTH / 2, ARENA.HEIGHT / 2);
  }

  drawArenaEnvironment() {
    // Background floor
    const bg = this.add.graphics();
    bg.fillStyle(ARENA.FLOOR_COLOR, 1);
    bg.fillRect(0, 0, ARENA.WIDTH, ARENA.HEIGHT);

    // Subtle grid lines
    bg.lineStyle(1, ARENA.GRID_COLOR, 0.5);
    const gridSize = 80;
    for (let x = 0; x <= ARENA.WIDTH; x += gridSize) {
      bg.lineBetween(x, 0, x, ARENA.HEIGHT);
    }
    for (let y = 0; y <= ARENA.HEIGHT; y += gridSize) {
      bg.lineBetween(0, y, ARENA.WIDTH, y);
    }

    // Outer Boundary Walls
    const wallG = this.add.graphics();
    const wt = ARENA.WALL_THICKNESS;

    // Glowing border outline
    wallG.lineStyle(4, 0x06b6d4, 0.4);
    wallG.strokeRect(wt / 2, wt / 2, ARENA.WIDTH - wt, ARENA.HEIGHT - wt);

    // Solid dark slate border walls
    wallG.fillStyle(ARENA.BOUNDS_COLOR, 1);
    wallG.fillRect(0, 0, ARENA.WIDTH, wt); // Top
    wallG.fillRect(0, ARENA.HEIGHT - wt, ARENA.WIDTH, wt); // Bottom
    wallG.fillRect(0, 0, wt, ARENA.HEIGHT); // Left
    wallG.fillRect(ARENA.WIDTH - wt, 0, wt, ARENA.HEIGHT); // Right
  }

  drawObstacles() {
    const obsGraphics = this.add.graphics();

    for (const obs of OBSTACLES) {
      // Obstacle body
      obsGraphics.fillStyle(0x1e293b, 1);
      obsGraphics.fillRoundedRect(obs.x, obs.y, obs.width, obs.height, 8);

      // Obstacle inner bevel
      obsGraphics.fillStyle(0x334155, 0.6);
      obsGraphics.fillRoundedRect(obs.x + 3, obs.y + 3, obs.width - 6, obs.height - 6, 6);

      // Obstacle border
      obsGraphics.lineStyle(2, 0x475569, 0.8);
      obsGraphics.strokeRoundedRect(obs.x, obs.y, obs.width, obs.height, 8);
    }
  }

  createFlagVisuals() {
    // Pulsing aura ring behind flag holder
    this.flagGlowRing = this.add.graphics();
    this.flagGlowRing.setDepth(15);
    this.flagGlowRing.setVisible(false);

    // Floating flag icon container
    this.flagContainer = this.add.container(0, 0);
    this.flagContainer.setDepth(30);
    this.flagContainer.setVisible(false);

    // Flag banner graphics
    const flagG = this.add.graphics();
    // Flag pole
    flagG.lineStyle(3, 0xffffff, 1);
    flagG.lineBetween(0, 0, 0, -32);

    // Golden flag cloth
    flagG.fillStyle(0xf59e0b, 1);
    flagG.beginPath();
    flagG.moveTo(0, -32);
    flagG.lineTo(24, -24);
    flagG.lineTo(0, -16);
    flagG.closePath();
    flagG.fillPath();

    // Flag outline
    flagG.lineStyle(1.5, 0xffedd5, 1);
    flagG.strokePath();

    this.flagContainer.add(flagG);

    // Bobbing animation for the flag
    this.tweens.add({
      targets: this.flagContainer,
      y: '-=6',
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  setupNetworkHooks() {
    // Snapshot state from authoritative server
    this.socketClient.on(EVENTS.SERVER.GAME_SNAPSHOT, (snap) => {
      this.handleSnapshot(snap);
    });

    // Instant flag transfer FX
    this.socketClient.on(EVENTS.SERVER.FLAG_TRANSFERRED, (data) => {
      this.onFlagTransferred(data);
    });

    // Hold bonus FX
    this.socketClient.on(EVENTS.SERVER.HOLD_BONUS_AWARDED, (data) => {
      this.onHoldBonus(data);
    });

    // Match start
    this.socketClient.on(EVENTS.SERVER.GAME_STARTED, (data) => {
      this.flagHolderId = data.flagHolderId;
      this.uiManager.showToast('🚀 MATCH STARTED! TAG PLAYERS TO PASS THE FLAG!', 'bonus');
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

    // Remove disconnected players
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

    // Find color definition
    const colorObj = PLAYER_CONFIG.COLORS.find((c) => c.hex === serverP.colorHex) ||
                     PLAYER_CONFIG.COLORS[this.playersMap.size % PLAYER_CONFIG.COLORS.length];

    const radius = PLAYER_CONFIG.RADIUS;

    // Outer glow / shadow
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.35);
    shadow.fillCircle(0, 4, radius);
    container.add(shadow);

    // Main body circle
    const body = this.add.graphics();
    body.fillStyle(colorObj.hex, 1);
    body.fillCircle(0, 0, radius);
    body.lineStyle(2.5, 0xffffff, 0.85);
    body.strokeCircle(0, 0, radius);
    container.add(body);

    // Cute facial eyes pointing forward
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
    const fromP = this.playersMap.get(data.fromId);
    const toP = this.playersMap.get(data.toId);

    soundSynth.playPass();

    // Floating popup text
    const textX = data.x || 800;
    const textY = (data.y || 500) - 30;

    const popup = this.add.text(textX, textY, `+${data.passBonus} PASS!`, {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '18px',
      fontStyle: '900',
      color: '#38bdf8',
      stroke: '#000000',
      strokeThickness: 4,
    });
    popup.setOrigin(0.5);
    popup.setDepth(50);

    this.tweens.add({
      targets: popup,
      y: textY - 40,
      alpha: 0,
      scale: 1.3,
      duration: 800,
      ease: 'Cubic.easeOut',
      onComplete: () => popup.destroy(),
    });

    // Particle flash circle
    const shockwave = this.add.graphics();
    shockwave.lineStyle(3, 0x38bdf8, 1);
    shockwave.strokeCircle(textX, textY, 20);
    shockwave.setDepth(45);

    this.tweens.add({
      targets: shockwave,
      scaleX: 2.5,
      scaleY: 2.5,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => shockwave.destroy(),
    });

    const fromName = fromP ? fromP.name : 'Player';
    const toName = toP ? toP.name : 'Player';
    this.uiManager.showToast(`🚩 ${fromName} passed the flag to ${toName}! (+5)`, 'transfer');
  }

  onHoldBonus(data) {
    soundSynth.playHoldBonus();

    const holder = this.playersMap.get(data.playerId);
    if (!holder) return;

    const posX = holder.container.x;
    const posY = holder.container.y - 45;

    const popup = this.add.text(posX, posY, `⭐ +${data.bonus} HOLD BONUS!`, {
      fontFamily: 'Outfit, sans-serif',
      fontSize: '20px',
      fontStyle: '900',
      color: '#f59e0b',
      stroke: '#000000',
      strokeThickness: 4,
    });
    popup.setOrigin(0.5);
    popup.setDepth(55);

    this.tweens.add({
      targets: popup,
      y: posY - 50,
      alpha: 0,
      scale: 1.4,
      duration: 900,
      ease: 'Back.easeOut',
      onComplete: () => popup.destroy(),
    });

    this.uiManager.showToast(`⭐ ${holder.name} held for 5s! (+8 bonus)`, 'bonus');
  }

  update(time, delta) {
    const dt = delta / 1000;

    // 1. Process local input and transmit to server
    this.handleInput(dt);

    // 2. Interpolate player positions smoothly towards server targets
    const lerpFactor = Math.min(1, dt * 24);

    for (const [id, visual] of this.playersMap.entries()) {
      const serverP = this.serverPlayerStates.get(id);
      if (serverP) {
        visual.container.x = Phaser.Math.Linear(visual.container.x, serverP.x, lerpFactor);
        visual.container.y = Phaser.Math.Linear(visual.container.y, serverP.y, lerpFactor);
        visual.scoreText.setText(serverP.s);

        // Orient eyes toward movement
        if (Math.hypot(serverP.vx, serverP.vy) > 10) {
          const angle = Math.atan2(serverP.vy, serverP.vx);
          const eyeDist = 4;
          visual.eyeG.x = Math.cos(angle) * eyeDist;
          visual.eyeG.y = Math.sin(angle) * eyeDist;
        }
      }
    }

    // 3. Render Flag Visuals over the Current Holder
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
    this.flagContainer.y = hy - PLAYER_CONFIG.RADIUS - 12;

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
    let iy = 0;

    // Desktop keyboard input
    if (this.cursors.left.isDown || this.wasd.left.isDown) ix -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) ix += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) iy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) iy += 1;

    // Mobile Virtual Joystick input
    if (this.virtualJoystick) {
      const joy = this.virtualJoystick.getInput();
      if (Math.hypot(joy.x, joy.y) > 0.05) {
        ix = joy.x;
        iy = joy.y;
      }
    }

    // Normalize diagonal input
    const len = Math.hypot(ix, iy);
    if (len > 1) {
      ix /= len;
      iy /= len;
    }

    // Send input to server at 30 Hz or immediately on direction change
    this.inputSendTimer += dt;
    const inputChanged = Math.abs(ix - this.lastSentInput.x) > 0.02 ||
                         Math.abs(iy - this.lastSentInput.y) > 0.02;

    if (inputChanged || this.inputSendTimer >= 1 / 30) {
      this.lastSentInput = { x: ix, y: iy };
      this.inputSendTimer = 0;
      this.socketClient.sendInput(ix, iy);
    }
  }
}
