// Real-time Socket.IO client manager
import { io } from 'socket.io-client';
import { EVENTS } from '../../../shared/constants.js';

export class SocketClient {
  constructor() {
    this.socket = null;
    this.ping = 0;
    this.pingInterval = null;
    this.eventListeners = new Map();

    // Determine backend server URL:
    // 1. Explicit environment variable (for production deployment on Vercel connecting to Render)
    // 2. Or relative path if frontend is served by Node.js server
    // 3. Or localhost:3001 default for local dev
    const envUrl = import.meta.env.VITE_SERVER_URL;
    const defaultUrl = window.location.port === '3000'
      ? `http://${window.location.hostname}:3001`
      : window.location.origin;

    this.serverUrl = envUrl || defaultUrl;
  }

  connect() {
    if (this.socket) return;

    this.socket = io(this.serverUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      this.startPingLoop();
      this.trigger('connect', { socketId: this.socket.id });
    });

    this.socket.on('disconnect', (reason) => {
      this.stopPingLoop();
      this.trigger('disconnect', { reason });
    });

    this.socket.on('connect_error', (error) => {
      this.trigger('connect_error', error);
    });

    // Wire standard game events
    Object.values(EVENTS.SERVER).forEach((eventName) => {
      this.socket.on(eventName, (data) => {
        this.trigger(eventName, data);
      });
    });
  }

  startPingLoop() {
    this.stopPingLoop();
    this.pingInterval = setInterval(() => {
      if (this.socket?.connected) {
        const start = performance.now();
        this.socket.emit(EVENTS.CLIENT.PING, start);
      }
    }, 2000);

    this.socket.on(EVENTS.SERVER.PONG, (startTime) => {
      const now = performance.now();
      this.ping = Math.round(now - startTime);
      this.trigger('ping_update', this.ping);
    });
  }

  stopPingLoop() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  trigger(event, data) {
    const list = this.eventListeners.get(event);
    if (list) {
      list.forEach((cb) => {
        try {
          cb(data);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      });
    }
  }

  // --- Client Actions ---

  createRoom(name, config = {}) {
    return new Promise((resolve) => {
      this.socket.emit(EVENTS.CLIENT.CREATE_ROOM, { name, config }, (res) => {
        resolve(res);
      });
    });
  }

  joinRoom(code, name) {
    return new Promise((resolve) => {
      this.socket.emit(EVENTS.CLIENT.JOIN_ROOM, { code, name }, (res) => {
        resolve(res);
      });
    });
  }

  leaveRoom() {
    if (this.socket) {
      this.socket.emit(EVENTS.CLIENT.LEAVE_ROOM);
    }
  }

  startGame() {
    if (this.socket) {
      this.socket.emit(EVENTS.CLIENT.START_GAME);
    }
  }

  rematch() {
    if (this.socket) {
      this.socket.emit(EVENTS.CLIENT.REMATCH);
    }
  }

  returnToLobby() {
    if (this.socket) {
      this.socket.emit(EVENTS.CLIENT.RETURN_LOBBY);
    }
  }

  changeSpeed(speedData) {
    return new Promise((resolve) => {
      if (!this.socket?.connected) return resolve({ success: false, reason: 'Not connected' });
      this.socket.emit(EVENTS.CLIENT.CHANGE_SPEED, speedData, (res) => {
        resolve(res || { success: true });
      });
    });
  }

  tossFlag() {
    return new Promise((resolve) => {
      if (!this.socket?.connected) return resolve({ success: false, reason: 'Not connected' });
      this.socket.emit(EVENTS.CLIENT.TOSS_FLAG, (res) => {
        resolve(res || { success: true });
      });
    });
  }

  sendInput(x, y, jump = false, dropDown = false) {
    if (this.socket?.connected) {
      this.socket.emit(EVENTS.CLIENT.PLAYER_INPUT, { x, y, jump, dropDown });
    }
  }
}
