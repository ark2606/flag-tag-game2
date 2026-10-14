// Master HTTP and WebSocket server entry point
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

import { CONFIG } from './config.js';
import { RoomManager } from './roomManager.js';
import { EVENTS } from '../../shared/constants.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// CORS setup for both Express and Socket.IO
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : '*';

app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

const roomManager = new RoomManager(io);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeRooms: roomManager.rooms.size,
    totalPlayers: roomManager.playerRoomMap.size,
    timestamp: Date.now(),
  });
});

// Optionally serve built static frontend if present (for single-container deploy)
const distPath = path.resolve(__dirname, '../../client/dist');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(distPath, 'index.html'), err => {
      if (err) next();
    });
  } else {
    next();
  }
});

// WebSocket event handling
io.on('connection', socket => {
  // Latency ping-pong
  socket.on(EVENTS.CLIENT.PING, clientTime => {
    socket.emit(EVENTS.SERVER.PONG, clientTime);
  });

  // Create room
  socket.on(EVENTS.CLIENT.CREATE_ROOM, (data, callback) => {
    try {
      const name = data?.name || 'Host';
      const result = roomManager.createRoom(socket.id, name, data?.config || {});

      if (result.success) {
        socket.join(result.code);
        socket.emit(EVENTS.SERVER.ROOM_CREATED, result);
        result.roomState.code = result.code;
        io.to(result.code).emit(EVENTS.SERVER.ROOM_STATE, result.roomState);
        if (typeof callback === 'function') callback({ success: true, code: result.code });
      } else {
        socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: result.reason });
        if (typeof callback === 'function') callback({ success: false, reason: result.reason });
      }
    } catch (err) {
      console.error('Error creating room:', err);
      socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: 'Internal error creating room.' });
    }
  });

  // Join room
  socket.on(EVENTS.CLIENT.JOIN_ROOM, (data, callback) => {
    try {
      const { code, name } = data || {};
      const result = roomManager.joinRoom(socket.id, code, name);

      if (result.success) {
        socket.join(result.code);
        socket.emit(EVENTS.SERVER.ROOM_JOINED, result);
        io.to(result.code).emit(EVENTS.SERVER.ROOM_STATE, result.roomState);
        if (typeof callback === 'function') callback({ success: true, code: result.code });
      } else {
        socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: result.reason });
        if (typeof callback === 'function') callback({ success: false, reason: result.reason });
      }
    } catch (err) {
      console.error('Error joining room:', err);
      socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: 'Internal error joining room.' });
    }
  });

  // Leave room
  socket.on(EVENTS.CLIENT.LEAVE_ROOM, () => {
    const code = roomManager.leaveCurrentRoom(socket.id);
    if (code) {
      socket.leave(code);
    }
  });

  // Start game countdown (Host only)
  socket.on(EVENTS.CLIENT.START_GAME, () => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) {
      return socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: 'You are not in an active room.' });
    }

    const res = room.startCountdown(socket.id);
    if (!res.success) {
      socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: res.reason });
    }
  });

  // Rematch (Host only)
  socket.on(EVENTS.CLIENT.REMATCH, () => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) return;

    const res = room.handleRematch(socket.id);
    if (!res.success) {
      socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: res.reason });
    }
  });

  // Return to Lobby (Host only)
  socket.on(EVENTS.CLIENT.RETURN_LOBBY, () => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) return;

    const res = room.handleReturnToLobby(socket.id);
    if (!res.success) {
      socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: res.reason });
    }
  });

  // Change Game Speed
  socket.on(EVENTS.CLIENT.CHANGE_SPEED, (data, callback) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, reason: 'You are not in a room.' });
      return;
    }

    const res = room.handleSpeedChange(socket.id, data);
    if (!res.success) {
      socket.emit(EVENTS.SERVER.ROOM_ERROR, { message: res.reason });
    }
    if (typeof callback === 'function') callback(res);
  });

  // Flag Toss request (authoritative coin flip to select flag holder)
  socket.on(EVENTS.CLIENT.TOSS_FLAG, (callback) => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ success: false, reason: 'You are not in a room.' });
      return;
    }

    const toss = room.performToss();
    if (typeof callback === 'function') callback({ success: true, toss });
  });

  // Player continuous input (dx, dy)
  socket.on(EVENTS.CLIENT.PLAYER_INPUT, input => {
    const room = roomManager.getPlayerRoom(socket.id);
    if (room) {
      room.handlePlayerInput(socket.id, input);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    roomManager.handleDisconnect(socket.id);
  });
});

const PORT = CONFIG.PORT;
server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` Flag-Tag Multiplayer Server Running!   `);
  console.log(` Port: ${PORT}                          `);
  console.log(` Health Check: http://localhost:${PORT}/health `);
  console.log(`=========================================`);
});

export { app, server, roomManager, io };
