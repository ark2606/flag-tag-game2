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
      this.ui.showScreen('lobby');
      this.ui.updateLobby(this.currentRoomState, this.myId);
    });

    this.network.on(EVENTS.SERVER.ROOM_JOINED, (data) => {
      this.currentRoomState = data.roomState;
      this.ui.showScreen('lobby');
      this.ui.updateLobby(this.currentRoomState, this.myId);
    });

    this.network.on(EVENTS.SERVER.ROOM_STATE, (state) => {
      this.currentRoomState = state;

      if (state.status === ROOM_STATUS.LOBBY) {
        this.ui.showScreen('lobby');
        this.ui.updateLobby(state, this.myId);
      } else if (state.status === ROOM_STATUS.PLAYING) {
        this.ui.showScreen('game');
      }
    });

    this.network.on(EVENTS.SERVER.COUNTDOWN_TICK, (data) => {
      this.ui.showScreen('game');
      this.ui.showCountdown(data.count);
    });

    this.network.on(EVENTS.SERVER.GAME_STARTED, () => {
      this.ui.showScreen('game');
      this.ui.showCountdown(0); // GO!
    });

    this.network.on(EVENTS.SERVER.GAME_ENDED, (data) => {
      const isHost = this.currentRoomState?.hostId === this.myId;
      this.ui.showResults(data, isHost);
    });

    this.network.on(EVENTS.SERVER.ROOM_ERROR, (err) => {
      this.ui.showToast(`⚠️ ${err.message || 'Error occurred'}`, 'error');
    });

    this.network.on('disconnect', () => {
      this.ui.showToast('⚠️ Disconnected from server. Reconnecting...', 'error');
    });
  }

  setupUIHandlers() {
    // Create Room
    this.ui.createRoomBtn.addEventListener('click', async () => {
      const name = this.ui.getPlayerName();
      this.ui.createRoomBtn.disabled = true;
      const res = await this.network.createRoom(name);
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
    });
  }
}

// Bootstrap once DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
