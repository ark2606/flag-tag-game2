// Main application bootstrap: connects Phaser, UI, Virtual Joystick, and Socket.IO
import Phaser from 'phaser';
import { ArenaScene } from './scenes/ArenaScene.js';
import { SocketClient } from './network/socketClient.js';
import { UIManager } from './ui/uiManager.js';
import { VirtualJoystick } from './input/virtualJoystick.js';
import { EVENTS, ROOM_STATUS } from '../../shared/constants.js';

class GameApp {
  constructor() {
    this.ui = new UIManager();
    this.network = new SocketClient();

    // Virtual Joystick for mobile/touch
    this.joystick = new VirtualJoystick(
      document.getElementById('virtual-joystick-zone'),
      document.getElementById('joystick-base'),
      document.getElementById('joystick-thumb')
    );

    this.myId = null;
    this.currentRoomState = null;
    this.phaserGame = null;
    this.pendingStartOnLandscape = false;
    window.__gameApp = this;

    this.init();
  }

  resizeGame() {
    const container = document.getElementById('game-container');
    if (!container || !this.phaserGame || !this.phaserGame.scale) return;

    // High-DPI / Device Pixel Ratio scaling for crystal clear graphics on mobile & retina displays
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = container.getBoundingClientRect();
    const cssWidth = Math.round(rect.width || window.innerWidth);
    const cssHeight = Math.round(rect.height || (window.innerHeight - 40));
    if (cssWidth <= 0 || cssHeight <= 0) return;

    this.phaserGame.scale.setZoom(1 / dpr);
    this.phaserGame.scale.resize(Math.round(cssWidth * dpr), Math.round(cssHeight * dpr));

    const scene = this.phaserGame.scene.getScene('ArenaScene');
    if (scene && typeof scene.fitCameraToScreen === 'function') {
      scene.fitCameraToScreen();
    }
  }

  init() {
    // 1. Initialize Phaser 3 Game with crisp High-DPI canvas configuration
    const config = {
      type: Phaser.AUTO,
      parent: 'game-container',
      backgroundColor: '#090d16',
      scale: {
        mode: Phaser.Scale.NONE,
        autoCenter: Phaser.Scale.NO_CENTER,
      },
      render: {
        antialias: true,
        antialiasGL: true,
        roundPixels: false,
      },
      scene: null, // Add scene explicitly with data to avoid empty auto-boot race conditions
    };

    this.phaserGame = new Phaser.Game(config);

    // Pass dependencies directly to ArenaScene upon creation
    this.phaserGame.scene.add('ArenaScene', ArenaScene, true, {
      socketClient: this.network,
      virtualJoystick: this.joystick,
      uiManager: this.ui,
      myId: null,
    });

    // Ensure mobile on-screen controls are visible when testing mobile/device layout on PC or real devices
    const updateMobileControlsVisibility = () => {
      const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
      const isMobileSize = window.innerHeight <= 600 || window.innerWidth <= 1024;
      const joystickZone = document.getElementById('virtual-joystick-zone');
      const mobileActions = document.getElementById('mobile-action-buttons');
      if (joystickZone && mobileActions) {
        if (isTouch || isMobileSize) {
          joystickZone.style.display = 'block';
          mobileActions.style.display = 'flex';
        }
      }
    };
    updateMobileControlsVisibility();

    const handleResize = () => {
      this.resizeGame();
      updateMobileControlsVisibility();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    if (screen.orientation) {
      screen.orientation.addEventListener('change', handleResize);
    }

    // Schedule initial layout sizing passes as DOM components settle
    setTimeout(() => this.resizeGame(), 50);
    setTimeout(() => this.resizeGame(), 200);
    setTimeout(() => this.resizeGame(), 500);

    // 2. Connect to Multiplayer WebSocket Server
    this.network.connect();
    this.setupNetworkEvents();

    // 3. Setup UI Button Handlers
    this.setupUIHandlers();
  }

  setupNetworkEvents() {
    this.network.on('connect', (data) => {
      this.myId = data.socketId;
      const scene = this.phaserGame.scene.getScene('ArenaScene');
      if (scene) scene.myId = this.myId;
      this.ui.updateConnectionStatus('connected');
      this.ui.setCreateRoomLoading(false);
      this.ui.setJoinRoomLoading(false);
    });

    this.network.on('server_awake', () => {
      if (!this.network.isConnected) {
        this.ui.updateConnectionStatus('connecting');
      }
    });

    this.network.on('ping_update', (pingMs) => {
      this.ui.updatePing(pingMs);
    });

    this.network.on(EVENTS.SERVER.ROOM_CREATED, (data) => {
      this.currentRoomState = data.roomState;
      if (this.currentRoomState) {
        this.ui.updateSpeedDisplay(this.currentRoomState.effectiveSpeed || this.currentRoomState.baseSpeed, this.currentRoomState.speedMultiplier);
        if (this.currentRoomState.timeRemaining) {
          this.ui.updateHudTimer(this.currentRoomState.timeRemaining);
        }
      }
      this.ui.showScreen('lobby');
      this.ui.updateLobby(this.currentRoomState, this.myId);
    });

    this.network.on(EVENTS.SERVER.ROOM_JOINED, (data) => {
      this.currentRoomState = data.roomState;
      if (this.currentRoomState) {
        this.ui.updateSpeedDisplay(this.currentRoomState.effectiveSpeed || this.currentRoomState.baseSpeed, this.currentRoomState.speedMultiplier);
        if (this.currentRoomState.timeRemaining) {
          this.ui.updateHudTimer(this.currentRoomState.timeRemaining);
        }
      }
      this.ui.showScreen('lobby');
      this.ui.updateLobby(this.currentRoomState, this.myId);
    });

    this.network.on(EVENTS.SERVER.ROOM_STATE, (state) => {
      this.currentRoomState = state;
      if (state.effectiveSpeed || state.baseSpeed) {
        this.ui.updateSpeedDisplay(state.effectiveSpeed || state.baseSpeed, state.speedMultiplier);
      }

      if (state.status === ROOM_STATUS.LOBBY) {
        this.ui.showScreen('lobby');
        this.ui.updateLobby(state, this.myId);
        this.ui.unlockSettings();
      } else if (state.status === ROOM_STATUS.PLAYING) {
        this.ui.showScreen('game');
        this.ui.lockSettings();
      }
    });

    this.network.on(EVENTS.SERVER.SPEED_UPDATED, (data) => {
      this.ui.updateSpeedDisplay(data.effectiveSpeed || data.baseSpeed, data.speedMultiplier);
      this.ui.showToast(`Match Speed: ${data.effectiveSpeed} px/s (${data.speedMultiplier}x)`, 'bonus');
    });

    this.network.on(EVENTS.SERVER.FLAG_TOSS, (tossData) => {
      this.ui.showTossAnimation(tossData);
    });

    this.network.on(EVENTS.SERVER.COUNTDOWN_TICK, (data) => {
      this.ui.showScreen('game');
      this.ui.showCountdown(data.count);
      // If player is in portrait, ensure rotate overlay is displayed
      if (this.ui.isPortrait()) {
        this.ui.showRotateOverlay();
      }
      // Lock settings once countdown begins
      if (data.count === 3) {
        this.ui.lockSettings();
      }
    });

    this.network.on(EVENTS.SERVER.GAME_STARTED, () => {
      this.ui.showScreen('game');
      this.ui.showCountdown(0); // GO!
      if (this.ui.isPortrait()) {
        this.ui.showRotateOverlay();
      }
      this.ui.lockSettings();
    });

    this.network.on(EVENTS.SERVER.PLAYER_LEFT, (data) => {
      this.ui.showToast(`${data.name || 'A player'} has left the room.`, 'warning');
      if (data.leftAlone || data.remainingPlayers === 1) {
        if (this.currentRoomState?.status === ROOM_STATUS.PLAYING || this.currentRoomState?.status === ROOM_STATUS.COUNTDOWN) {
          this.ui.showGameOverAlone('Everyone has left the room!');
        } else if (this.currentRoomState?.status === ROOM_STATUS.LOBBY) {
          this.ui.showToast('Everyone else has left the room. You are now alone.', 'error');
        }
      }
    });

    this.network.on(EVENTS.SERVER.LEFT_ALONE, (data) => {
      this.ui.showGameOverAlone(data?.message || 'Everyone has left the room!');
    });

    this.network.on(EVENTS.SERVER.GAME_ENDED, (data) => {
      const isHost = this.currentRoomState?.hostId === this.myId;
      if (data?.reason === 'all_players_left') {
        this.ui.showGameOverAlone(data.message || 'Everyone has left the room!');
      } else {
        this.ui.showResults(data, isHost);
      }
      this.ui.unlockSettings();
      this.ui.hidePhaseActive();
    });

    this.network.on(EVENTS.SERVER.ROOM_ERROR, (err) => {
      this.ui.showToast(`${err.message || 'Error occurred'}`, 'error');
      this.ui.setCreateRoomLoading(false);
      this.ui.setJoinRoomLoading(false);
    });

    this.network.on('disconnect', () => {
      this.ui.updateConnectionStatus('disconnected');
      this.ui.showToast('Disconnected from server. Reconnecting...', 'error');
      this.ui.setCreateRoomLoading(false);
      this.ui.setJoinRoomLoading(false);
    });

    this.network.on('connect_error', () => {
      this.ui.updateConnectionStatus('waking');
      this.ui.setCreateRoomLoading(false);
      this.ui.setJoinRoomLoading(false);
    });

    this.network.on('reconnect_attempt', () => {
      this.ui.updateConnectionStatus('connecting');
    });
  }

  setupUIHandlers() {
    // Speed change requests from UI panel & lobby (Host only)
    this.ui.onSpeedChangeRequest = async (changeData) => {
      const res = await this.network.changeSpeed(changeData);
      if (res && !res.success) {
        this.ui.showToast(`${res.reason || 'Could not change speed'}`, 'error');
      }
    };

    // Create Room
    this.ui.createRoomBtn.addEventListener('click', async () => {
      if (this.ui.createRoomBtn.disabled) return;
      const name = this.ui.getPlayerName();
      this.ui.setCreateRoomLoading(true);

      try {
        const customConfig = {
          match: { ROUND_DURATION: Number.isFinite(this.ui.selectedTimer) ? this.ui.selectedTimer : 120 },
          player: { BASE_SPEED: Number.isFinite(this.ui.currentMult) ? Math.round(440 * this.ui.currentMult) : 440 },
        };

        const res = await this.network.createRoom(name, customConfig, (statusText) => {
          this.ui.setCreateRoomLoading(true, statusText);
          this.ui.showToast(statusText, 'warning');
        });
        if (!res || !res.success) {
          this.ui.showToast(`${res?.reason || 'Could not create room'}`, 'error');
        }
      } catch (err) {
        console.error('Error creating room:', err);
        this.ui.showToast('Could not create room. Please try again.', 'error');
      } finally {
        this.ui.setCreateRoomLoading(false);
      }
    });

    // Join Room
    this.ui.joinRoomBtn.addEventListener('click', async () => {
      if (this.ui.joinRoomBtn.disabled) return;
      const code = this.ui.joinCodeInput.value.trim().toUpperCase();
      const name = this.ui.getPlayerName();

      if (!code) {
        return this.ui.showToast('Please enter a room code.', 'error');
      }

      this.ui.setJoinRoomLoading(true);
      try {
        const res = await this.network.joinRoom(code, name, (statusText) => {
          this.ui.setJoinRoomLoading(true, statusText);
          this.ui.showToast(statusText, 'warning');
        });
        if (!res || !res.success) {
          this.ui.showToast(`${res?.reason || 'Could not join room'}`, 'error');
        }
      } catch (err) {
        console.error('Error joining room:', err);
        this.ui.showToast('Could not join room. Please try again.', 'error');
      } finally {
        this.ui.setJoinRoomLoading(false);
      }
    });

    // Leave Room
    this.ui.leaveRoomBtn.addEventListener('click', () => {
      this.pendingStartOnLandscape = false;
      this.currentRoomState = null;
      this.network.leaveRoom();
      this.ui.showScreen('menu');
    });

    // Handle Leave Room from Game Over Alone / Rotate overlay
    this.ui.onLeaveRoomRequest = () => {
      this.pendingStartOnLandscape = false;
      this.currentRoomState = null;
      this.network.leaveRoom();
      this.ui.showScreen('menu');
    };

    // Handle Return to Lobby from Game Over Alone
    this.ui.onReturnToLobbyRequest = () => {
      this.pendingStartOnLandscape = false;
      this.network.returnToLobby();
      this.ui.showScreen('lobby');
      this.ui.unlockSettings();
      this.ui.hidePhaseActive();
    };

    // Start Game (Host only) - only start if in landscape, otherwise block until landscape
    this.ui.startGameBtn.addEventListener('click', () => {
      if (this.ui.isPortrait()) {
        this.pendingStartOnLandscape = true;
        this.ui.showToast('Please rotate to landscape orientation to start the game.', 'warning');
        this.ui.showRotateOverlay(true);
        return;
      }
      this.pendingStartOnLandscape = false;
      this.network.startGame();
    });

    // Auto-start once landscape is detected if host clicked start while in portrait
    const checkLandscapeStart = () => {
      if (!this.ui.isPortrait() && this.pendingStartOnLandscape) {
        this.pendingStartOnLandscape = false;
        this.ui.showToast('Landscape detected. Starting match...', 'bonus');
        this.network.startGame();
      }
    };
    window.addEventListener('resize', checkLandscapeStart);
    window.addEventListener('orientationchange', checkLandscapeStart);
    if (screen.orientation) {
      screen.orientation.addEventListener('change', checkLandscapeStart);
    }

    // Rematch (Host only)
    this.ui.resultsRematchBtn.addEventListener('click', () => {
      this.network.rematch();
    });

    // Return to Lobby (Host only)
    this.ui.resultsLobbyBtn.addEventListener('click', () => {
      this.network.returnToLobby();
      this.ui.showScreen('lobby');
      this.ui.unlockSettings();
      this.ui.hidePhaseActive();
    });
  }
}

// Bootstrap once DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
