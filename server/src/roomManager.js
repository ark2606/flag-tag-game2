// Room Manager: handles room lifecycle, code generation, and lookup
import { GameRoom } from './gameRoom.js';

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> GameRoom
    this.playerRoomMap = new Map(); // socketId -> code
  }

  /**
   * Generates a clean 5-character room code without ambiguous characters.
   */
  generateCode() {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    let attempts = 0;

    do {
      code = '';
      for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      attempts++;
    } while (this.rooms.has(code) && attempts < 1000);

    return code;
  }

  /**
   * Creates a new game room.
   */
  createRoom(hostSocketId, hostName, customConfig = {}) {
    // If player already in a room, leave first
    this.leaveCurrentRoom(hostSocketId);

    const code = this.generateCode();
    const room = new GameRoom(code, hostSocketId, this.io, customConfig);
    const joinResult = room.addPlayer(hostSocketId, hostName);

    if (!joinResult.success) {
      return { success: false, reason: joinResult.reason };
    }

    this.rooms.set(code, room);
    this.playerRoomMap.set(hostSocketId, code);

    return {
      success: true,
      code,
      player: joinResult.player,
      roomState: room.getRoomState(),
    };
  }

  /**
   * Joins an existing room by code.
   */
  joinRoom(socketId, rawCode, playerName) {
    this.leaveCurrentRoom(socketId);

    if (!rawCode || typeof rawCode !== 'string') {
      return { success: false, reason: 'Invalid room code provided.' };
    }

    const code = rawCode.trim().toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      return { success: false, reason: `Room "${code}" not found. Please check the code.` };
    }

    const result = room.addPlayer(socketId, playerName);
    if (!result.success) {
      return { success: false, reason: result.reason };
    }

    this.playerRoomMap.set(socketId, code);

    return {
      success: true,
      code,
      player: result.player,
      roomState: room.getRoomState(),
    };
  }

  /**
   * Gets the room a player is currently in.
   */
  getPlayerRoom(socketId) {
    const code = this.playerRoomMap.get(socketId);
    if (!code) return null;
    return this.rooms.get(code) || null;
  }

  /**
   * Leaves current room.
   */
  leaveCurrentRoom(socketId) {
    const code = this.playerRoomMap.get(socketId);
    if (!code) return null;

    const room = this.rooms.get(code);
    this.playerRoomMap.delete(socketId);

    if (room) {
      room.removePlayer(socketId);
      if (room.players.size === 0) {
        room.stopSimulation();
        this.rooms.delete(code);
      } else {
        room.broadcastRoomState();
      }
    }

    return code;
  }

  /**
   * Handles player disconnection.
   */
  handleDisconnect(socketId) {
    return this.leaveCurrentRoom(socketId);
  }
}
