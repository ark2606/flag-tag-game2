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

    this.init();
  }

  init() {
    // 1. Initialize Phaser 3 Game
    const config = {
      type: Phaser.AUTO,
      parent: 'game-container',
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: '#090d16',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [ArenaScene],
    };

    this.phaserGame = new Phaser.Game(config);

    // Pass dependencies to ArenaScene once created
    this.phaserGame.scene.start('ArenaScene', {
      socketClient: this.network,
      virtualJoystick: this.joystick,
      uiManager: this.ui,
      myId: null,
    });

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
      this.ui.showToast(`⚡ Match Speed: ${data.effectiveSpeed} px/s (${data.speedMultiplier}x)`, 'bonus');
    });

    this.network.on(EVENTS.SERVER.FLAG_TOSS, (tossData) => {
      this.ui.showTossAnimation(tossData);
    });

    this.network.on(EVENTS.SERVER.COUNTDOWN_TICK, (data) => {
      this.ui.showScreen('game');
      this.ui.showCountdown(data.count);
      // Lock settings once countdown begins
      if (data.count === 3) {
        this.ui.lockSettings();
      }
    });

    this.network.on(EVENTS.SERVER.GAME_STARTED, () => {
      this.ui.showScreen('game');
      this.ui.showCountdown(0); // GO!
      this.ui.lockSettings();
    });

    this.network.on(EVENTS.SERVER.GAME_ENDED, (data) => {
      const isHost = this.currentRoomState?.hostId === this.myId;
      this.ui.showResults(data, isHost);
      this.ui.unlockSettings();
      this.ui.hidePhaseActive();
    });

    this.network.on(EVENTS.SERVER.ROOM_ERROR, (err) => {
      this.ui.showToast(`⚠️ ${err.message || 'Error occurred'}`, 'error');
    });

    this.network.on('disconnect', () => {
      this.ui.showToast('⚠️ Disconnected from server. Reconnecting...', 'error');
    });
  }

  setupUIHandlers() {
    // Speed change requests from UI panel & lobby (Host only)
    this.ui.onSpeedChangeRequest = async (changeData) => {
      const res = await this.network.changeSpeed(changeData);
      if (res && !res.success) {
        this.ui.showToast(`⚠️ ${res.reason || 'Could not change speed'}`, 'error');
      }
    };

    // Create Room
    this.ui.createRoomBtn.addEventListener('click', async () => {
      const name = this.ui.getPlayerName();
      this.ui.createRoomBtn.disabled = true;

      const customConfig = {
        match: { ROUND_DURATION: this.ui.selectedTimer || 120 },
        player: { BASE_SPEED: Math.round(440 * (this.ui.currentMult || 1.0)) },
      };

      const res = await this.network.createRoom(name, customConfig);
      this.ui.createRoomBtn.disabled = false;
      if (!res.success) {
        this.ui.showToast(`⚠️ ${res.reason || 'Could not create room'}`, 'error');
      }
    });

    // Join Room
    this.ui.joinRoomBtn.addEventListener('click', async () => {
      const code = this.ui.joinCodeInput.value.trim().toUpperCase();
      const name = this.ui.getPlayerName();

      if (!code) {
        return this.ui.showToast('⚠️ Please enter a room code.', 'error');
      }

      this.ui.joinRoomBtn.disabled = true;
      const res = await this.network.joinRoom(code, name);
      this.ui.joinRoomBtn.disabled = false;
      if (!res.success) {
        this.ui.showToast(`⚠️ ${res.reason || 'Could not join room'}`, 'error');
      }
    });

    // Leave Room
    this.ui.leaveRoomBtn.addEventListener('click', () => {
      this.network.leaveRoom();
      this.ui.showScreen('menu');
    });

    // Start Game (Host only)
    this.ui.startGameBtn.addEventListener('click', () => {
      this.network.startGame();
    });

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
