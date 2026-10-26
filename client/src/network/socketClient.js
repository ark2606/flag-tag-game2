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
    const envUrl = import.meta.env.VITE_SERVER_URL?.trim().replace(/\/+$/, '');
    let defaultUrl;
    if (import.meta.env.DEV) {
      // In local development, Node server is on port 3001
      const isServerPort = window.location.port === '3001';
      defaultUrl = isServerPort
        ? window.location.origin
        : `http://${window.location.hostname}:3001`;
    } else {
      defaultUrl = window.location.origin;
    }

    this.serverUrl = envUrl || defaultUrl;
    this.keepAliveInterval = null;
    this.startKeepAliveLoop();
  }

  wakeUpServer() {
    if (!this.serverUrl) return;
    const healthUrl = `${this.serverUrl}/health`;
    fetch(healthUrl, { method: 'GET', cache: 'no-store' })
      .then((res) => {
        if (res.ok) {
          this.trigger('server_awake');
        }
      })
      .catch(() => {
        // Will be connected/retried via socket
      });
  }

  startKeepAliveLoop() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    // Ping health check every 9 minutes to keep cloud server awake while game tab is open
    this.keepAliveInterval = setInterval(() => {
      this.wakeUpServer();
    }, 9 * 60 * 1000);
  }

  get isConnected() {
    return Boolean(this.socket && this.socket.connected);
  }

  connect() {
    if (this.socket) {
      if (this.socket.disconnected) {
        this.socket.connect();
      }
      return;
    }

    // Immediately trigger server wake-up via HTTP health check
    this.wakeUpServer();

    this.socket = io(this.serverUrl, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 30000,
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

    this.socket.io.on('reconnect_attempt', (attempt) => {
      this.trigger('reconnect_attempt', attempt);
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

  /**
   * Ensures the socket is connected before emitting actions.
   * If the socket is connecting or server is sleeping (cold start on Render),
   * waits up to timeoutMs (default 45s) while giving the player honest feedback.
   */
  async ensureConnected(timeoutMs = 45000, onStatusUpdate = null) {
    if (this.socket?.connected) return true;

    if (!this.socket) {
      this.connect();
    } else if (this.socket.disconnected) {
      this.socket.connect();
    }

    // Ping health endpoint to ensure cloud host wakes up
    this.wakeUpServer();

    if (this.socket?.connected) return true;

    return new Promise((resolve) => {
      let timer = null;
      let wakeNoticeTimer = null;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (wakeNoticeTimer) clearTimeout(wakeNoticeTimer);
        if (this.socket) {
          this.socket.off('connect', onConnect);
        }
      };

      const onConnect = () => {
        cleanup();
        resolve(true);
      };

      // If connection takes > 3.5s, server is likely waking from sleep mode
      wakeNoticeTimer = setTimeout(() => {
        if (!this.socket?.connected && typeof onStatusUpdate === 'function') {
          onStatusUpdate('Waking up server (takes ~30s on free hosting)...');
        }
      }, 3500);

      timer = setTimeout(() => {
        cleanup();
        resolve(Boolean(this.socket?.connected));
      }, timeoutMs);

      this.socket.once('connect', onConnect);
    });
  }

  // --- Client Actions ---

  async createRoom(name, config = {}, onStatusUpdate = null) {
    const connected = await this.ensureConnected(45000, onStatusUpdate);
    if (!connected) {
      return {
        success: false,
        reason: 'Game server took too long to wake up. Please wait a few seconds and try again.',
      };
    }

    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, reason: 'Server took too long to create room. Please try again.' });
        }
      }, 10000);

      this.socket.emit(EVENTS.CLIENT.CREATE_ROOM, { name, config }, (res) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(res || { success: true });
        }
      });
    });
  }

  async joinRoom(code, name, onStatusUpdate = null) {
    const connected = await this.ensureConnected(45000, onStatusUpdate);
    if (!connected) {
      return {
        success: false,
        reason: 'Game server took too long to wake up. Please wait a few seconds and try again.',
      };
    }

    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, reason: 'Server took too long to join room. Please try again.' });
        }
      }, 10000);

      this.socket.emit(EVENTS.CLIENT.JOIN_ROOM, { code, name }, (res) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(res || { success: true });
        }
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
