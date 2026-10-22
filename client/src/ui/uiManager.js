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
    this.topScorecardBar = document.getElementById('top-scorecard-bar');
    this.pingText = document.getElementById('ping-text');
    this.soundToggleBtn = document.getElementById('sound-toggle-btn');
    this.volumeSlider = document.getElementById('volume-slider');

    // Speed Panel elements
    this.speedControlPanel = document.getElementById('speed-control-panel');
    this.speedValue = document.getElementById('speed-value');
    this.speedMult = document.getElementById('speed-mult');
    this.speedIncBtn = document.getElementById('speed-inc-btn');
    this.speedDecBtn = document.getElementById('speed-dec-btn');
    this.speedPresetBtns = document.querySelectorAll('.speed-preset-btn');
    this.lobbySpeedPills = document.querySelectorAll('#lobby-speed-pills .pill-btn');
    this.lobbyTimerPills = document.querySelectorAll('#lobby-timer-pills .pill-btn');
    this.lobbySettingsTitle = document.getElementById('lobby-settings-title');
    this.isCurrentHost = false;

    // Phase banner elements
    this.phaseBanner = document.getElementById('phase-banner');
    this.phaseTitle = document.getElementById('phase-title');
    this.phaseDescription = document.getElementById('phase-description');

    // Mobile controls & Fullscreen
    this.mobileJumpBtn = document.getElementById('mobile-jump-btn');
    this.mobileDropBtn = document.getElementById('mobile-drop-btn');
    this.fullscreenBtn = document.getElementById('fullscreen-btn');
    this.rotateOverlay = document.getElementById('rotate-device-overlay');
    this.rotateFullscreenBtn = document.getElementById('rotate-fullscreen-btn');
    this.rotateLeaveBtn = document.getElementById('rotate-leave-btn');

    // Game Over Alone modal
    this.gameOverAloneOverlay = document.getElementById('game-over-alone-overlay');
    this.aloneMessageText = document.getElementById('alone-message-text');
    this.aloneBackLobbyBtn = document.getElementById('alone-back-lobby-btn');
    this.aloneMenuBtn = document.getElementById('alone-menu-btn');
    this.onLeaveRoomRequest = null;
    this.onReturnToLobbyRequest = null;

    // Flag Toss animation overlay (triggered on match start)
    this.tossOverlay = document.getElementById('toss-overlay');
    this.tossCoin = document.getElementById('toss-coin');
    this.tossAvatar = document.getElementById('toss-avatar');
    this.tossName = document.getElementById('toss-name');
    this.tossWinnerBanner = document.getElementById('toss-winner-banner');
    this.tossWinnerName = document.getElementById('toss-winner-name');
    this.tossInterval = null;
    this.tossTimeout = null;

    this.currentSpeed = 440;
    this.currentMult = 1.0;
    this.selectedTimer = 120;
    this.onSpeedChangeRequest = null;

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

    // Volume slider listener
    if (this.volumeSlider) {
      this.volumeSlider.value = soundSynth.volume * 100;
      this.volumeSlider.addEventListener('input', (e) => {
        const vol = parseFloat(e.target.value) / 100;
        soundSynth.setVolume(vol);
      });
    }

    // Speed control button listeners (Host only)
    if (this.speedIncBtn) {
      this.speedIncBtn.addEventListener('click', () => {
        if (!this.isCurrentHost) {
          this.showToast('⚠️ Only the room host (👑) can change match speed.', 'error');
          return;
        }
        if (typeof this.onSpeedChangeRequest === 'function') {
          this.onSpeedChangeRequest({ delta: 40 });
        }
      });
    }

    if (this.speedDecBtn) {
      this.speedDecBtn.addEventListener('click', () => {
        if (!this.isCurrentHost) {
          this.showToast('⚠️ Only the room host (👑) can change match speed.', 'error');
          return;
        }
        if (typeof this.onSpeedChangeRequest === 'function') {
          this.onSpeedChangeRequest({ delta: -40 });
        }
      });
    }

    if (this.speedPresetBtns) {
      this.speedPresetBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          if (!this.isCurrentHost) {
            this.showToast('⚠️ Only the room host (👑) can change match speed.', 'error');
            return;
          }
          const mult = parseFloat(btn.dataset.mult);
          if (typeof this.onSpeedChangeRequest === 'function' && !isNaN(mult)) {
            this.onSpeedChangeRequest({ multiplier: mult });
          }
        });
      });
    }

    // Lobby settings pills listeners (Host only)
    if (this.lobbySpeedPills) {
      this.lobbySpeedPills.forEach((pill) => {
        pill.addEventListener('click', () => {
          if (!this.isCurrentHost) {
            this.showToast('⚠️ Only the room host (👑) can change match speed.', 'error');
            return;
          }
          const mult = parseFloat(pill.dataset.speedMult);
          if (typeof this.onSpeedChangeRequest === 'function' && !isNaN(mult)) {
            this.onSpeedChangeRequest({ multiplier: mult });
          }
        });
      });
    }

    if (this.lobbyTimerPills) {
      this.lobbyTimerPills.forEach((pill) => {
        pill.addEventListener('click', () => {
          if (!this.isCurrentHost) {
            this.showToast('⚠️ Only the room host (👑) can change round duration.', 'error');
            return;
          }
          this.lobbyTimerPills.forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');
          this.selectedTimer = parseInt(pill.dataset.timer, 10) || 120;
          this.updateHudTimer(this.selectedTimer);
        });
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

    // Toss flag button
    if (this.tossTestBtn) {
      this.tossTestBtn.addEventListener('click', () => {
        if (typeof this.onTossRequest === 'function') {
          this.onTossRequest();
        }
      });
    }
    // Fullscreen / Landscape toggle button
    if (this.fullscreenBtn) {
      this.fullscreenBtn.addEventListener('click', () => {
        this.toggleFullscreen();
      });
      document.addEventListener('fullscreenchange', () => {
        const isFs = !!document.fullscreenElement;
        this.fullscreenBtn.textContent = isFs ? '🗗' : '⛶';
      });
    }

    // Orientation detection & rotate overlay
    this.setupOrientationDetection();
  }

  async toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
        if (screen.orientation && screen.orientation.lock) {
          try {
            await screen.orientation.lock('landscape');
          } catch (e) {
            // lock may not be allowed without system permission or on iOS
          }
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      }
    } catch (e) {
      // Ignored
    }
  }

  isPortrait() {
    return window.innerHeight > window.innerWidth;
  }

  showRotateOverlay(force = true) {
    if (this.rotateOverlay) {
      this.rotateOverlay.classList.remove('hidden');
    }
  }

  hideRotateOverlay() {
    if (this.rotateOverlay) {
      this.rotateOverlay.classList.add('hidden');
    }
  }

  showGameOverAlone(customMessage) {
    if (this.inGameHud) this.inGameHud.classList.add('hidden');
    if (this.countdownBanner) this.countdownBanner.classList.add('hidden');

    if (this.gameOverAloneOverlay) {
      if (customMessage && this.aloneMessageText) {
        this.aloneMessageText.textContent = customMessage;
      }
      this.gameOverAloneOverlay.classList.remove('hidden');
      this.gameOverAloneOverlay.classList.add('active');
    }
    soundSynth.playGameOver();
  }

  hideGameOverAlone() {
    if (this.gameOverAloneOverlay) {
      this.gameOverAloneOverlay.classList.add('hidden');
      this.gameOverAloneOverlay.classList.remove('active');
    }
  }

  setupOrientationDetection() {
    if (this.rotateLeaveBtn) {
      this.rotateLeaveBtn.addEventListener('click', () => {
        this.hideRotateOverlay();
        if (typeof this.onLeaveRoomRequest === 'function') {
          this.onLeaveRoomRequest();
        } else {
          this.showScreen('menu');
        }
      });
    }

    if (this.aloneBackLobbyBtn) {
      this.aloneBackLobbyBtn.addEventListener('click', () => {
        this.hideGameOverAlone();
        if (typeof this.onReturnToLobbyRequest === 'function') {
          this.onReturnToLobbyRequest();
        } else {
          this.showScreen('lobby');
          this.unlockSettings();
          this.hidePhaseActive();
        }
      });
    }

    if (this.aloneMenuBtn) {
      this.aloneMenuBtn.addEventListener('click', () => {
        this.hideGameOverAlone();
        if (typeof this.onLeaveRoomRequest === 'function') {
          this.onLeaveRoomRequest();
        } else {
          this.showScreen('menu');
        }
      });
    }

    if (this.rotateFullscreenBtn) {
      this.rotateFullscreenBtn.addEventListener('click', async () => {
        await this.toggleFullscreen();
      });
    }

    const checkOrientation = () => {
      const isPortrait = this.isPortrait();
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

      // When in touch environment or mobile emulation in portrait mode
      if (isPortrait && isTouch) {
        this.showRotateOverlay();
      } else if (!isPortrait) {
        this.hideRotateOverlay();
      }
    };

    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);
    if (screen.orientation) {
      screen.orientation.addEventListener('change', checkOrientation);
    }

    setTimeout(checkOrientation, 150);
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
    this.hideGameOverAlone();

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
    this.isCurrentHost = isHost;

    if (isHost) {
      this.startGameBtn.classList.remove('hidden');
      this.waitingNotice.classList.add('hidden');
      this.startGameBtn.disabled = players.length < 2;
      this.startGameBtn.title = players.length < 2 ? 'Need at least 2 players' : 'Start Match';

      if (this.lobbySettingsTitle) {
        this.lobbySettingsTitle.innerHTML = '⚙️ MATCH SETTINGS <span class="badge-role-tag host-tag">👑 You Control Settings</span>';
      }

      this.lobbySpeedPills?.forEach((pill) => {
        pill.disabled = false;
        pill.classList.remove('disabled-guest');
      });
      this.lobbyTimerPills?.forEach((pill) => {
        pill.disabled = false;
        pill.classList.remove('disabled-guest');
      });
    } else {
      this.startGameBtn.classList.add('hidden');
      this.waitingNotice.classList.remove('hidden');

      if (this.lobbySettingsTitle) {
        this.lobbySettingsTitle.innerHTML = '⚙️ MATCH SETTINGS <span class="badge-role-tag guest-tag">🔒 Controlled by Host (👑)</span>';
      }

      this.lobbySpeedPills?.forEach((pill) => {
        pill.disabled = true;
        pill.classList.add('disabled-guest');
      });
      this.lobbyTimerPills?.forEach((pill) => {
        pill.disabled = true;
        pill.classList.add('disabled-guest');
      });
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

  showTossAnimation(tossData) {
    if (!this.tossOverlay) return;

    if (this.tossInterval) clearInterval(this.tossInterval);
    if (this.tossTimeout) clearTimeout(this.tossTimeout);

    const candidates = tossData.candidates || [];
    const winnerName = tossData.winnerName || 'Player';
    const winnerColor = tossData.winnerColor || '#f59e0b';
    const startingBonus = tossData.startingBonus || 30;

    // Show toss overlay
    this.tossOverlay.classList.remove('hidden');
    if (this.tossCoin) this.tossCoin.classList.add('flipping');
    if (this.tossWinnerBanner) this.tossWinnerBanner.classList.add('hidden');

    let step = 0;
    const maxSteps = 16;
    const intervalMs = 90;

    this.tossInterval = setInterval(() => {
      step++;
      const currentCandidate = candidates[step % candidates.length] || { name: 'Player', color: { css: '#06b6d4' } };

      if (this.tossAvatar) {
        this.tossAvatar.style.backgroundColor = currentCandidate.color?.css || '#06b6d4';
        this.tossAvatar.textContent = (currentCandidate.name || 'P').charAt(0).toUpperCase();
      }
      if (this.tossName) {
        this.tossName.textContent = currentCandidate.name;
      }

      soundSynth.playTossSpin(step);

      if (step >= maxSteps) {
        clearInterval(this.tossInterval);
        this.tossInterval = null;

        // Reveal winner!
        if (this.tossCoin) this.tossCoin.classList.remove('flipping');
        if (this.tossAvatar) {
          this.tossAvatar.style.backgroundColor = winnerColor;
          this.tossAvatar.textContent = winnerName.charAt(0).toUpperCase();
        }
        if (this.tossName) {
          this.tossName.textContent = winnerName;
        }

        if (this.tossWinnerBanner) {
          this.tossWinnerBanner.classList.remove('hidden');
        }
        if (this.tossWinnerName) {
          this.tossWinnerName.innerHTML = `<span style="color:${winnerColor}">🚩</span> ${winnerName}`;
        }

        soundSynth.playTossWin();
        this.showToast(`🪙 Flag Toss: ${winnerName} gets the flag! (+${startingBonus} bonus)`, 'bonus');
        this.updateHudFlagHolder(winnerName, winnerColor);

        // Auto hide toss overlay after display
        this.tossTimeout = setTimeout(() => {
          if (this.tossOverlay) this.tossOverlay.classList.add('hidden');
        }, 1800);
      }
    }, intervalMs);
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

  updateSpeedDisplay(speed, mult) {
    this.currentSpeed = Math.round(speed || 440);
    this.currentMult = typeof mult === 'number' ? Math.round(mult * 10) / 10 : 1.0;

    if (this.speedValue) {
      this.speedValue.textContent = this.currentSpeed;
    }
    if (this.speedMult) {
      this.speedMult.textContent = `${this.currentMult.toFixed(1)}x`;
    }

    if (this.speedPresetBtns) {
      this.speedPresetBtns.forEach((btn) => {
        const btnMult = parseFloat(btn.dataset.mult);
        btn.classList.toggle('active', Math.abs(btnMult - this.currentMult) < 0.05);
      });
    }

    if (this.lobbySpeedPills) {
      this.lobbySpeedPills.forEach((pill) => {
        const pillMult = parseFloat(pill.dataset.speedMult);
        pill.classList.toggle('active', Math.abs(pillMult - this.currentMult) < 0.05);
      });
    }
  }

  updateScoreboard(players, flagHolderId) {
    if (!this.scoreboardList) return;

    if (!players || players.length === 0) {
      this.scoreboardList.innerHTML = '<div class="score-empty-hint">Waiting for round to start...</div>';
      return;
    }

    // Sort players by score descending
    const sorted = [...players].sort((a, b) => b.s - a.s);

    this.scoreboardList.innerHTML = '';
    sorted.forEach((p, idx) => {
      const chip = document.createElement('div');
      const isHolder = p.id === flagHolderId;
      chip.className = `score-chip ${isHolder ? 'is-holder' : ''}`;

      // Rank badge
      const rank = document.createElement('span');
      rank.className = `score-rank rank-${idx + 1}`;
      rank.textContent = idx === 0 ? '👑' : `#${idx + 1}`;

      // Colored avatar dot
      const dot = document.createElement('span');
      dot.className = 'score-dot';
      dot.style.backgroundColor = p.colorCss || '#06b6d4';

      // Player name
      const name = document.createElement('span');
      name.className = 'score-name';
      name.textContent = (isHolder ? '🚩 ' : '') + (p.name || 'Player');

      // Points
      const score = document.createElement('span');
      score.className = 'score-points';
      score.textContent = p.s;

      chip.appendChild(rank);
      chip.appendChild(dot);
      chip.appendChild(name);
      chip.appendChild(score);
      this.scoreboardList.appendChild(chip);
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

  // --- Settings Panel Visibility Control ---

  /**
   * Hide and disable speed control panel during active gameplay.
   * Called when countdown starts or match is in progress.
   */
  lockSettings() {
    if (this.speedControlPanel) {
      this.speedControlPanel.style.display = 'none';
    }
    if (this.speedIncBtn) this.speedIncBtn.disabled = true;
    if (this.speedDecBtn) this.speedDecBtn.disabled = true;
    if (this.speedPresetBtns) {
      this.speedPresetBtns.forEach((btn) => (btn.disabled = true));
    }
    if (this.lobbySpeedPills) {
      this.lobbySpeedPills.forEach((pill) => (pill.disabled = true));
    }
    if (this.lobbyTimerPills) {
      this.lobbyTimerPills.forEach((pill) => (pill.disabled = true));
    }
  }

  /**
   * Show and enable speed control panel when returning to lobby or on results screen.
   */
  unlockSettings() {
    if (this.speedControlPanel) {
      this.speedControlPanel.style.display = '';
    }
    if (this.speedIncBtn) this.speedIncBtn.disabled = false;
    if (this.speedDecBtn) this.speedDecBtn.disabled = false;
    if (this.speedPresetBtns) {
      this.speedPresetBtns.forEach((btn) => (btn.disabled = false));
    }
    if (this.lobbySpeedPills) {
      this.lobbySpeedPills.forEach((pill) => (pill.disabled = false));
    }
    if (this.lobbyTimerPills) {
      this.lobbyTimerPills.forEach((pill) => (pill.disabled = false));
    }
  }

  // --- Dynamic Scoring Phase Banner ---

  /**
   * Show unobtrusive 5-second advance warning before a scoring phase activates.
   */
  showPhaseWarning(data) {
    if (!this.phaseBanner || !data) return;

    this.phaseBanner.classList.remove('hidden', 'active');
    this.phaseBanner.classList.add('warning');

    if (this.phaseTitle) {
      this.phaseTitle.textContent = '⚡ BONUS PHASE INCOMING';
    }
    if (this.phaseDescription) {
      this.phaseDescription.textContent = `${data.name || 'Special Scoring'} starts in 5 seconds!`;
    }
  }

  /**
   * Show active scoring phase banner with live multiplier indicator.
   */
  showPhaseActive(data) {
    if (!this.phaseBanner || !data) return;

    this.phaseBanner.classList.remove('hidden', 'warning');
    this.phaseBanner.classList.add('active');

    if (this.phaseTitle) {
      this.phaseTitle.textContent = `🔥 ${data.name || 'BONUS PHASE'}`;
    }
    if (this.phaseDescription) {
      this.phaseDescription.textContent = data.description || 'Special scoring rules active!';
    }
  }

  /**
   * Hide scoring phase banner when phase ends or round completes.
   */
  hidePhaseActive() {
    if (!this.phaseBanner) return;
    this.phaseBanner.classList.add('hidden');
    this.phaseBanner.classList.remove('warning', 'active');
  }
}
