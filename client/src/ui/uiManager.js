// UI Manager: controls screens, HUD, scoreboard, toasts, and DOM interactions
import { soundSynth } from './soundSynth.js';

export class UIManager {
  constructor() {
    // Screens
    this.mainMenu = document.getElementById('main-menu');
    this.lobbyScreen = document.getElementById('lobby-screen');
    this.inGameHud = document.getElementById('in-game-hud');
    this.resultsScreen = document.getElementById('results-screen');

    // Inputs & Buttons
    this.playerNameInput = document.getElementById('player-name-input');
    this.createRoomBtn = document.getElementById('create-room-btn');
    this.joinCodeInput = document.getElementById('join-code-input');
    this.joinRoomBtn = document.getElementById('join-room-btn');
    this.lobbyRoomCode = document.getElementById('lobby-room-code');
    this.copyInviteBtn = document.getElementById('copy-invite-btn');
    this.playerCount = document.getElementById('player-count');
    this.lobbyPlayerList = document.getElementById('lobby-player-list');
    this.leaveRoomBtn = document.getElementById('leave-room-btn');
    this.startGameBtn = document.getElementById('start-game-btn');
    this.waitingNotice = document.getElementById('waiting-notice');

    // HUD elements
    this.hudTimer = document.getElementById('hud-timer');
    this.hudTimerCard = document.getElementById('hud-timer-card');
    this.hudFlagText = document.getElementById('hud-flag-text');
    this.scoreboardList = document.getElementById('scoreboard-list');
    this.countdownBanner = document.getElementById('countdown-banner');
    this.countdownNumber = document.getElementById('countdown-number');
    this.toastContainer = document.getElementById('toast-container');

    // Results screen elements
    this.winnerAnnouncement = document.getElementById('winner-announcement');
    this.winnerSubtitle = document.getElementById('winner-subtitle');
    this.rankingsBody = document.getElementById('rankings-body');
    this.resultsRematchBtn = document.getElementById('results-rematch-btn');
    this.resultsLobbyBtn = document.getElementById('results-lobby-btn');

    // Top Bar elements
    this.pingText = document.getElementById('ping-text');
    this.soundToggleBtn = document.getElementById('sound-toggle-btn');

    this.init();
  }

  init() {
    // Load saved username
    const savedName = localStorage.getItem('flagtag_name');
    if (savedName && this.playerNameInput) {
      this.playerNameInput.value = savedName;
    }

    // Auto-fill room code from URL parameters (?room=XYZ)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam && this.joinCodeInput) {
      this.joinCodeInput.value = roomParam.trim().toUpperCase();
      this.joinCodeInput.focus();
    }

    // Sound toggle listener
    if (this.soundToggleBtn) {
      this.soundToggleBtn.textContent = soundSynth.isMuted ? '🔇' : '🔊';
      this.soundToggleBtn.addEventListener('click', () => {
        const muted = soundSynth.toggleMute();
        this.soundToggleBtn.textContent = muted ? '🔇' : '🔊';
      });
    }

    // Copy invite button
    if (this.copyInviteBtn) {
      this.copyInviteBtn.addEventListener('click', () => {
        const code = this.lobbyRoomCode.textContent;
        const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${code}`;
        navigator.clipboard.writeText(inviteUrl).then(() => {
          const originalText = this.copyInviteBtn.textContent;
          this.copyInviteBtn.textContent = '✅ Copied Link!';
          setTimeout(() => {
            this.copyInviteBtn.textContent = originalText;
          }, 2000);
        });
      });
    }
  }

  getPlayerName() {
    const name = this.playerNameInput.value.trim() || 'Player';
    localStorage.setItem('flagtag_name', name);
    return name;
  }

  showScreen(screenName) {
    [this.mainMenu, this.lobbyScreen, this.resultsScreen].forEach((el) => {
      if (el) el.classList.remove('active');
    });

    if (screenName === 'menu' && this.mainMenu) {
      this.mainMenu.classList.add('active');
      this.inGameHud.classList.add('hidden');
    } else if (screenName === 'lobby' && this.lobbyScreen) {
      this.lobbyScreen.classList.add('active');
      this.inGameHud.classList.add('hidden');
    } else if (screenName === 'game' && this.inGameHud) {
      this.inGameHud.classList.remove('hidden');
    } else if (screenName === 'results' && this.resultsScreen) {
      this.resultsScreen.classList.add('active');
      this.inGameHud.classList.add('hidden');
    }
  }

  updatePing(ms) {
    if (this.pingText) {
      this.pingText.textContent = `${ms} ms`;
    }
  }

  updateLobby(roomState, myId) {
    if (!roomState) return;

    this.lobbyRoomCode.textContent = roomState.code || '-----';
    const players = roomState.players || [];
    this.playerCount.textContent = players.length;

    const isHost = roomState.hostId === myId;
    if (isHost) {
      this.startGameBtn.classList.remove('hidden');
      this.waitingNotice.classList.add('hidden');
      this.startGameBtn.disabled = players.length < 2;
      this.startGameBtn.title = players.length < 2 ? 'Need at least 2 players' : 'Start Match';
    } else {
      this.startGameBtn.classList.add('hidden');
      this.waitingNotice.classList.remove('hidden');
    }

    // Populate roster
    this.lobbyPlayerList.innerHTML = '';
    players.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'player-card';

      const avatar = document.createElement('div');
      avatar.className = 'player-avatar-circle';
      avatar.style.backgroundColor = p.color?.css || '#06b6d4';
      avatar.textContent = (p.name || 'P').charAt(0).toUpperCase();

      const name = document.createElement('div');
      name.className = 'player-name-label';
      name.textContent = p.name + (p.id === myId ? ' (You)' : '');

      const badge = document.createElement('div');
      badge.className = `player-role-badge ${p.isHost ? 'host' : ''}`;
      badge.textContent = p.isHost ? '👑 HOST' : 'PLAYER';

      card.appendChild(avatar);
      card.appendChild(name);
      card.appendChild(badge);
      this.lobbyPlayerList.appendChild(card);
    });
  }

  showCountdown(number) {
    this.countdownBanner.classList.remove('hidden');
    this.countdownNumber.textContent = number === 0 ? 'GO!' : number;

    soundSynth.playCountdown(number === 0);

    if (number === 0) {
      setTimeout(() => {
        this.countdownBanner.classList.add('hidden');
      }, 700);
    }
  }

  updateHudTimer(secondsRemaining) {
    const sec = Math.max(0, Math.ceil(secondsRemaining));
    this.hudTimer.textContent = sec;

    if (sec <= 10) {
      this.hudTimerCard.style.borderColor = '#ef4444';
      this.hudTimer.style.color = '#ef4444';
    } else {
      this.hudTimerCard.style.borderColor = 'rgba(255, 255, 255, 0.1)';
      this.hudTimer.style.color = '#ffffff';
    }
  }

  updateHudFlagHolder(holderName, colorHex = '#f59e0b') {
    if (holderName) {
      this.hudFlagText.innerHTML = `Flag Holder: <strong style="color: ${colorHex}">${holderName}</strong>`;
    } else {
      this.hudFlagText.innerHTML = `Flag Holder: <strong>None</strong>`;
    }
  }

  updateScoreboard(players, flagHolderId) {
    if (!this.scoreboardList) return;

    // Sort players by score descending
    const sorted = [...players].sort((a, b) => b.s - a.s);

    this.scoreboardList.innerHTML = '';
    sorted.forEach((p) => {
      const row = document.createElement('div');
      const isHolder = p.id === flagHolderId;
      row.className = `scoreboard-row ${isHolder ? 'holding-flag' : ''}`;

      const left = document.createElement('div');
      left.className = 'scoreboard-player-info';

      const dot = document.createElement('div');
      dot.className = 'scoreboard-dot';
      dot.style.backgroundColor = p.colorCss || '#06b6d4';

      const name = document.createElement('span');
      name.className = 'scoreboard-name';
      name.textContent = (isHolder ? '🚩 ' : '') + (p.name || 'Player');

      left.appendChild(dot);
      left.appendChild(name);

      const score = document.createElement('span');
      score.className = 'scoreboard-score';
      score.textContent = p.s;

      row.appendChild(left);
      row.appendChild(score);
      this.scoreboardList.appendChild(row);
    });
  }

  showResults(resultsData, isHost) {
    this.showScreen('results');

    const { rankings, winner, finalPenalty } = resultsData;

    if (winner) {
      this.winnerAnnouncement.textContent = `🎉 ${winner.name} WINS!`;
      this.winnerSubtitle.textContent = `Winning score: ${winner.finalScore} points`;
    } else {
      this.winnerAnnouncement.textContent = 'ROUND COMPLETE!';
      this.winnerSubtitle.textContent = '';
    }

    if (isHost) {
      this.resultsRematchBtn.classList.remove('hidden');
    } else {
      this.resultsRematchBtn.classList.add('hidden');
    }

    this.rankingsBody.innerHTML = '';
    rankings.forEach((r, idx) => {
      const tr = document.createElement('tr');

      const rankTd = document.createElement('td');
      rankTd.textContent = idx === 0 ? '🥇 1st' : idx === 1 ? '🥈 2nd' : idx === 2 ? '🥉 3rd' : `${idx + 1}th`;

      const playerTd = document.createElement('td');
      playerTd.innerHTML = `<span style="color:${r.color?.css || '#06b6d4'}">●</span> ${r.name} ${r.wasFinalHolder ? '<small style="color:#ef4444">(Penalty -40)</small>' : ''}`;

      const passesTd = document.createElement('td');
      passesTd.textContent = r.passesMade;

      const timeTd = document.createElement('td');
      timeTd.textContent = `${r.timeHeld}s`;

      const scoreTd = document.createElement('td');
      scoreTd.style.fontFamily = 'var(--font-mono)';
      scoreTd.style.fontWeight = '700';
      scoreTd.textContent = r.finalScore;

      tr.appendChild(rankTd);
      tr.appendChild(playerTd);
      tr.appendChild(passesTd);
      tr.appendChild(timeTd);
      tr.appendChild(scoreTd);

      this.rankingsBody.appendChild(tr);
    });

    soundSynth.playGameOver();
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 2800);
  }
}
