# 🚩 FLAG-TAG: 2D Online Multiplayer Arena Game

A fast, competitive, skill-based 2D top-down multiplayer tag game built from scratch with **Phaser 3**, **Node.js**, **Socket.IO**, and **Vite**.

Players move freely in all four directions inside a rectangular arena with obstacles. There is **exactly ONE flag** in the arena. The objective is to score as many points as possible by strategically holding, passing, and avoiding being trapped with the flag when the timer hits zero!

---

## 🎮 Game Concept & Rules

### Core Flag Transfer Mechanic
- **Single Flag:** There is exactly one flag in active play.
- **Immediate Transfer:** When the current flag holder physically touches another player, the flag transfers **immediately** to the player they touched.
- **Zero Transfer Cooldown:** There is no artificial cooldown, timer, or temporary immunity. If the new holder immediately touches a third player, or separates and touches again, the flag transfers instantly.
- **Contact State Tracking:** The server tracks active contact pairs. A single continuous overlapping contact does not spam duplicate transfers every frame. As soon as players separate by even a fraction of a pixel, a fresh contact is re-armed.

### Central Configurable Scoring System
| Event | Points Awarded | Notes |
|---|---|---|
| **Starting Bonus** | **+30 points** | Awarded to the randomly selected initial holder at round start. |
| **Current Holder** | **−2 points / sec** | Passive point deduction while holding the hot potato. |
| **Non-Holders** | **+1 point / sec** | Passive point gain for staying safe without the flag. |
| **5-Second Continuous Hold** | **+8 bonus points** | Rewarded for every uninterrupted 5 seconds of holding. Resets if lost early. |
| **Successful Pass** | **+5 points** | Awarded to the player who tagged another player to pass the flag. |
| **End-of-Round Penalty** | **−40 points** | Deducted once from whichever player is holding the flag when the timer expires. |

---

## 🏗️ Architecture & Project Structure

The project uses a clean, decoupled architecture:

```
flag-tag-game/
├── package.json              # Root workspace orchestrator
├── .gitignore                # Git ignore patterns
├── .env.example              # Environment variables template
├── README.md                 # Full documentation and deployment guide
│
├── shared/
│   └── constants.js          # Shared arena layout, obstacles, scoring, and network events
│
├── server/                   # Authoritative Node.js Multiplayer Server
│   ├── package.json
│   ├── src/
│   │   ├── index.js          # Express + Socket.IO server, CORS, health checks
│   │   ├── config.js         # Central server & scoring configuration
│   │   ├── gameRoom.js       # Authoritative physics tick (30 Hz), flag logic, scoring
│   │   ├── physics.js        # Circle vs Circle & Circle vs AABB obstacle collision resolution
│   │   └── roomManager.js    # 5-character room code generation, lifecycle, cleanups
│   └── tests/
│       └── game.test.js      # 15 automated server tests
│
└── client/                   # Frontend Browser Game
    ├── package.json
    ├── vite.config.js        # Vite dev server and production builder
    ├── index.html            # Main menu, lobby, HUD, scoreboard, results modal
    └── src/
        ├── main.js           # Phaser + Socket.IO bootstrap & state coordination
        ├── style.css         # Modern dark arcade theme & responsive layouts
        ├── input/
        │   └── virtualJoystick.js  # Touch virtual joystick for mobile devices
        ├── network/
        │   └── socketClient.js     # Socket.IO client wrapper & latency tracking
        ├── scenes/
        │   └── ArenaScene.js       # Phaser 3 scene, player rendering, interpolation, flag visuals
        └── ui/
            ├── soundSynth.js       # Procedural Web Audio sound effects (zero audio assets needed)
            └── uiManager.js        # Lobby, scoreboard, timers, toast notifications, results
```

---

## 🧪 Automated Testing

The game comes with an automated test suite verifying all server authority, collision, scoring, and edge-case mechanics using Node's native test runner (`node:test`).

### Run the tests:
```bash
cd server
npm test
```

### Verified Test Cases:
1. **Room creation and joining:** Creates private rooms with unique 5-character codes and tracks host.
2. **Invalid room code rejection:** Rejects nonexistent codes with clear error messages.
3. **Room capacity enforcement:** Enforces strict 8-player maximum.
4. **Initial flag assignment & starting bonus:** Gives initial holder +30 points.
5. **Valid flag transfers & pass bonus:** Awards +5 points to the passer and updates ownership.
6. **Immediate transfer after new contact (Zero cooldown):** Validates immediate subsequent transfers.
7. **No duplicate transfer during continuous contact:** Contact pairs remain stable; no ping-pong score farming.
8. **Immediate transfer upon separation and re-touch:** Fresh contact re-arms instantly.
9. **Simultaneous contact handling:** No duplicate flags or conflicting ownership.
10. **Scoring over time:** Holder loses 2 pts/sec, non-holders gain 1 pt/sec.
11. **5-second continuous hold bonus (+8 pts):** Awards bonus on qualifying uninterrupted periods; resets on loss.
12. **End-of-round penalty (-40 pts):** Applied exactly once when time reaches zero.
13. **Round termination and rematch:** Resets state cleanly between rounds.
14. **Disconnecting player handling:** If flag holder leaves, re-assigns flag to remaining player without crashing.
15. **Anti-exploit validation:** Malicious client input cannot spoof scores or flag ownership.

---

## 💻 Local Development (Beginner-Friendly)

### Prerequisites
- [Node.js](https://nodejs.org/) (Version 18 or higher. Node 24 is already tested and supported).
- [VS Code](https://code.visualstudio.com/) (or any code editor).

### Step-by-Step Instructions

#### 1. Open the project in VS Code
Open VS Code, click **File > Open Folder...**, and select `C:\Users\ankas\flag-tag-game`.

#### 2. Install Dependencies
Open a terminal in VS Code (**Terminal > New Terminal**) and run:
```bash
# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

#### 3. Start the Server (Terminal 1)
In your first terminal:
```bash
cd server
npm run dev
```
You will see:
```
=========================================
 Flag-Tag Multiplayer Server Running!
 Port: 3001
 Health Check: http://localhost:3001/health
=========================================
```

#### 4. Start the Client (Terminal 2)
Click the `+` icon in the VS Code terminal to open a second terminal:
```bash
cd client
npm run dev
```
Vite will output:
```
  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.x.x:3000/
```

#### 5. Open the Game in Your Browser
Visit [http://localhost:3000](http://localhost:3000) in your web browser.

---

## 👥 Two-Browser Local Testing Procedure

To verify multiplayer functionality locally on one computer:

1. **Window 1 (Host):**
   - Open [http://localhost:3000](http://localhost:3000) in a standard Chrome/Edge window.
   - Enter your nickname (e.g. `Alice`).
   - Click **⚡ Create Private Room**.
   - You are now in the Lobby. You will see a 5-letter Room Code (e.g., `TAG8X`) and a **📋 Copy Invite Link** button.

2. **Window 2 (Guest):**
   - Open an **Incognito / Private window** (or a second browser like Firefox or Brave) at [http://localhost:3000](http://localhost:3000).
   - Enter a nickname (e.g. `Bob`).
   - Type the 5-letter Room Code into the code box and click **Join** (or paste the invite link copied from Window 1).

3. **Verify Lobby Synchronization:**
   - Both windows will instantly display 2 players with assigned avatars, colors, and the host crown.
   - The Host window's **🚀 Start Match** button will become enabled.

4. **Start Match & Play:**
   - On the Host window, click **🚀 Start Match**.
   - Both windows will see the `3.. 2.. 1.. GO!` countdown.
   - Use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys to move.
   - Collide with the other player: watch the flag transfer instantly with sound, floating text, and a particle burst!
   - Watch the scoreboard and 90-second countdown in real time.
   - When the countdown finishes, both windows display the results screen with final scores, penalties, and winner rankings.
   - The host can click **Rematch** or **Return to Lobby** to play again!

---

## 🚀 Free Online Deployment (Step-by-Step)

You can host Flag-Tag online so friends anywhere in the world can play from their phones or laptops without installing anything.

### Architecture for Free Hosting
- **Frontend Host:** [Vercel](https://vercel.com/) (100% free for static frontend apps with global CDN).
- **Multiplayer Server Host:** [Render](https://render.com/) (Free Web Service tier with native WebSockets support).
  *Note: Render's free tier spins down after 15 minutes of inactivity; the first visit will take ~45 seconds to wake up, after which real-time WebSocket gameplay is fully active.*

---

### Step 1: Install Git (If not already installed)
1. Download Git from [https://git-scm.com/download/win](https://git-scm.com/download/win) and install it with default options.
2. In VS Code, verify Git works:
   ```bash
   git --version
   ```

### Step 2: Initialize Git & Push to GitHub
1. Create a free account at [GitHub](https://github.com/).
2. Create a new repository named `flag-tag-arena` (select **Public**).
3. In your VS Code terminal in the project root (`flag-tag-game`):
   ```bash
   git init
   git add .
   git commit -m "Initial commit of complete Flag-Tag multiplayer game"
   git branch -M main
   git remote add origin https://github.com/YOUR_GITHUB_USERNAME/flag-tag-arena.git
   git push -u origin main
   ```

---

### Step 3: Deploy the Backend on Render (Free)
1. Go to [Render.com](https://render.com/) and sign up with your GitHub account.
2. Click **New +** > **Web Service**.
3. Select your `flag-tag-arena` repository.
4. Fill in the settings:
   - **Name:** `flag-tag-server`
   - **Region:** Choose the region closest to you.
   - **Root Directory:** `server`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Click **Advanced** and add an Environment Variable:
   - Key: `CORS_ORIGIN`
   - Value: `*` (or your Vercel URL once created)
6. Click **Deploy Web Service**.
7. Wait ~2 minutes until Render gives you your live backend URL (e.g., `https://flag-tag-server.onrender.com`).
8. Test it in your browser: `https://flag-tag-server.onrender.com/health` should return `{"status":"healthy"}`.

---

### Step 4: Deploy the Frontend on Vercel (Free)
1. Go to [Vercel.com](https://vercel.com/) and log in with your GitHub account.
2. Click **Add New... > Project**.
3. Import your `flag-tag-arena` repository.
4. In the Project Configuration:
   - **Root Directory:** Click "Edit" and choose `client`.
   - **Framework Preset:** `Vite`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Expand **Environment Variables** and add:
   - Name: `VITE_SERVER_URL`
   - Value: `https://flag-tag-server.onrender.com` *(Replace with your exact Render backend URL from Step 3)*
6. Click **Deploy**.
7. Vercel will build your game in ~30 seconds and give you a public URL (e.g., `https://flag-tag-arena.vercel.app`).

---

### Step 5: Update Backend CORS (Security Best Practice)
1. Go back to your Render Dashboard for `flag-tag-server`.
2. Go to **Environment** > change `CORS_ORIGIN` to:
   `https://flag-tag-arena.vercel.app`
3. Click **Save Changes**. Render will automatically redeploy.

---

## 📱 How Your Friends Will Play

1. Send your live Vercel URL to your friends via WhatsApp, Discord, or SMS:
   `https://flag-tag-arena.vercel.app`
2. You click **⚡ Create Private Room**.
3. Click **📋 Copy Invite Link** and send the invite link (e.g., `https://flag-tag-arena.vercel.app/?room=TAG8X`) to your friends.
4. Friends simply open the link on their iPhone, Android, Mac, or PC:
   - No login, no GitHub, no software downloads, no terminal commands.
   - The room code is automatically filled in!
5. When everyone is in the lobby, click **🚀 Start Match**!
6. On mobile, an on-screen touch joystick automatically appears. On desktop, players use <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys.

---

## 🔧 Diagnostics & Troubleshooting

| Issue | Likely Cause | Solution |
|---|---|---|
| **"Cannot connect to server"** | Backend server is asleep or not running. | Check `http://localhost:3001/health` (local) or your Render URL `/health`. If on Render free tier, wait 45 seconds for cold start. |
| **Players can't join room** | Typo in room code or room expired. | Ensure 5-letter code matches uppercase. Check that match hasn't already started (rooms lock during active gameplay). |
| **Diagonal movement is too fast** | Diagonal normalization missing. | Server and client both calculate `Math.hypot(x, y)` and normalize if length > 1. |
| **CORS error in browser console** | `CORS_ORIGIN` on backend does not match frontend domain. | Set `CORS_ORIGIN=*` or specify frontend URL on Render environment variables. |

---

## 📄 License
MIT License. Free for educational and commercial use.
