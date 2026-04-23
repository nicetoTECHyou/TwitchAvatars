// ============================================================================
// Avatar Stream System - Server
// ============================================================================
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const tmi = require('tmi.js');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ---------------------------------------------------------------------------
// Express + HTTP + Socket.io
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 5000
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Routes
app.get('/overlay', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay', 'index.html'));
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ---------------------------------------------------------------------------
// Avatar State
// ---------------------------------------------------------------------------
const avatars = new Map(); // username -> avatar object
let battleRoyaleActive = false;
let battleRoyaleZone = null;

const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
  '#A3E4D7', '#FAD7A0', '#A9CCE3', '#D5F5E3', '#FADBD8'
];

function createAvatar(username, platform = 'twitch') {
  if (avatars.has(username.toLowerCase())) {
    return avatars.get(username.toLowerCase());
  }

  const colorIndex = avatars.size % AVATAR_COLORS.length;
  const avatar = {
    id: username.toLowerCase(),
    username: username,
    platform: platform,
    x: 100 + Math.random() * (config.overlay.width - 200),
    y: config.overlay.height - 100 - config.avatar.size,
    vx: (Math.random() - 0.5) * config.avatar.defaultSpeed * 2,
    vy: 0,
    width: config.avatar.size,
    height: config.avatar.size,
    color: AVATAR_COLORS[colorIndex],
    hp: 100,
    maxHp: 100,
    isJumping: false,
    jumpStartTime: 0,
    direction: Math.random() > 0.5 ? 1 : -1,
    state: 'idle',        // idle, walking, jumping, attacking, dancing, dead
    animFrame: 0,
    animTimer: 0,
    attackCooldown: 0,
    targetId: null,
    spawnTime: Date.now(),
    spriteName: null       // custom sprite key if loaded
  };

  avatars.set(username.toLowerCase(), avatar);
  broadcastState();
  return avatar;
}

function removeAvatar(username) {
  const key = username.toLowerCase();
  if (avatars.has(key)) {
    avatars.delete(key);
    broadcastState();
  }
}

// ---------------------------------------------------------------------------
// Battle Royale Logic
// ---------------------------------------------------------------------------
function startBattleRoyale() {
  if (avatars.size < 2) return false;
  battleRoyaleActive = true;
  battleRoyaleZone = {
    x: 0,
    y: 0,
    width: config.overlay.width,
    height: config.overlay.height,
    targetX: 0,
    targetY: 0,
    targetWidth: config.overlay.width,
    targetHeight: config.overlay.height
  };

  // Reset all avatars for battle
  for (const avatar of avatars.values()) {
    avatar.hp = 100;
    avatar.maxHp = 100;
    avatar.state = 'idle';
    avatar.targetId = null;
    avatar.attackCooldown = 0;
    // Scatter positions
    avatar.x = 100 + Math.random() * (config.overlay.width - 200);
    avatar.y = config.overlay.height - 100 - config.avatar.size;
    avatar.vx = (Math.random() - 0.5) * 4;
  }

  io.emit('battleRoyaleStart', { zone: battleRoyaleZone });
  broadcastState();
  return true;
}

function stopBattleRoyale() {
  battleRoyaleActive = false;
  battleRoyaleZone = null;
  // Revive all dead avatars
  for (const avatar of avatars.values()) {
    if (avatar.state === 'dead') {
      avatar.hp = 100;
      avatar.maxHp = 100;
      avatar.state = 'idle';
    }
  }
  io.emit('battleRoyaleEnd');
  broadcastState();
}

function nukeAll() {
  const explosionEffects = [];
  for (const avatar of avatars.values()) {
    explosionEffects.push({ x: avatar.x, y: avatar.y, color: avatar.color });
  }
  avatars.clear();
  battleRoyaleActive = false;
  battleRoyaleZone = null;
  io.emit('nuke', { explosions: explosionEffects });
  broadcastState();
}

// ---------------------------------------------------------------------------
// Chat Command Handler
// ---------------------------------------------------------------------------
function handleChatCommand(username, command, platform) {
  const cmd = command.toLowerCase().trim();

  if (cmd === config.commands.join) {
    const avatar = createAvatar(username, platform);
    io.emit('avatarJoined', { username, platform, color: avatar.color });
    return;
  }

  // All commands below require an existing avatar
  const avatar = avatars.get(username.toLowerCase());
  if (!avatar || avatar.state === 'dead') return;

  switch (cmd) {
    case config.commands.jump:
      if (!avatar.isJumping) {
        avatar.isJumping = true;
        avatar.jumpStartTime = Date.now();
        avatar.state = 'jumping';
        io.emit('avatarJumped', { username: avatar.username });
      }
      break;

    case config.commands.attack:
      if (battleRoyaleActive && avatar.attackCooldown <= 0) {
        avatar.state = 'attacking';
        avatar.attackCooldown = config.battleRoyale.attackCooldown;
        setTimeout(() => {
          if (avatar.state === 'attacking') avatar.state = 'idle';
        }, 300);
      }
      break;

    case config.commands.dance:
      avatar.state = 'dancing';
      setTimeout(() => {
        if (avatar.state === 'dancing') avatar.state = 'idle';
      }, 2000);
      break;
  }

  broadcastState();
}

// ---------------------------------------------------------------------------
// Twitch Chat (tmi.js)
// ---------------------------------------------------------------------------
let twitchClient = null;

function connectTwitch() {
  if (!config.twitch.enabled || twitchClient) return;

  twitchClient = new tmi.Client({
    channels: config.twitch.channels
  });

  twitchClient.on('message', (channel, tags, message, self) => {
    if (self) return;
    const username = tags['display-name'] || tags.username || 'Unknown';
    handleChatCommand(username, message, 'twitch');
  });

  twitchClient.on('connected', () => {
    console.log('[Twitch] Connected to channels:', config.twitch.channels.join(', '));
  });

  twitchClient.on('disconnected', (reason) => {
    console.log('[Twitch] Disconnected:', reason);
  });

  twitchClient.connect().catch(err => {
    console.error('[Twitch] Connection error:', err.message);
  });
}

function disconnectTwitch() {
  if (twitchClient) {
    twitchClient.disconnect();
    twitchClient = null;
  }
}

// ---------------------------------------------------------------------------
// Kick Chat Simulator
// ---------------------------------------------------------------------------
let kickSimInterval = null;

function startKickSimulator() {
  if (!config.kick.enabled) return;
  console.log('[Kick] Simulator active. Send messages via /api/kick-sim');

  // The simulator is triggered via API, not polling
}

function stopKickSimulator() {
  if (kickSimInterval) {
    clearInterval(kickSimInterval);
    kickSimInterval = null;
  }
}

// API endpoint to simulate Kick messages (for testing)
app.post('/api/kick-sim', (req, res) => {
  const { username, message } = req.body;
  if (!username || !message) {
    return res.status(400).json({ error: 'username and message required' });
  }
  handleChatCommand(username, message, 'kick');
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------
app.get('/api/state', (_req, res) => {
  res.json({
    avatars: Array.from(avatars.values()),
    battleRoyaleActive,
    config
  });
});

app.post('/api/spawn-test', (req, res) => {
  const { username } = req.body;
  const name = username || `TestUser_${Math.floor(Math.random() * 999)}`;
  const avatar = createAvatar(name, 'test');
  res.json({ success: true, avatar });
});

app.post('/api/battle-royale', (req, res) => {
  const { action } = req.body;
  if (action === 'start') {
    const result = startBattleRoyale();
    res.json({ success: result, message: result ? 'Battle Royale gestartet!' : 'Mindestens 2 Avatare erforderlich!' });
  } else {
    stopBattleRoyale();
    res.json({ success: true, message: 'Battle Royale beendet!' });
  }
});

app.post('/api/nuke', (_req, res) => {
  nukeAll();
  res.json({ success: true, message: 'Nuke ausgelöst! Alle Avatare zerstört!' });
});

app.post('/api/remove-avatar', (req, res) => {
  const { username } = req.body;
  removeAvatar(username);
  res.json({ success: true });
});

app.post('/api/clear-all', (_req, res) => {
  avatars.clear();
  battleRoyaleActive = false;
  battleRoyaleZone = null;
  broadcastState();
  res.json({ success: true });
});

app.post('/api/config', (req, res) => {
  const newConfig = req.body;
  config = { ...config, ...newConfig };
  saveConfig();
  res.json({ success: true, config });
});

app.post('/api/twitch/connect', (_req, res) => {
  connectTwitch();
  res.json({ success: true });
});

app.post('/api/twitch/disconnect', (_req, res) => {
  disconnectTwitch();
  res.json({ success: true });
});

app.get('/api/sprites', (_req, res) => {
  const spritesDir = path.join(__dirname, 'public', 'sprites', 'avatars');
  try {
    const files = fs.readdirSync(spritesDir).filter(f =>
      f.endsWith('.png') || f.endsWith('.json')
    );
    res.json({ sprites: files });
  } catch {
    res.json({ sprites: [] });
  }
});

// ---------------------------------------------------------------------------
// Socket.io Events
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Send current state to new client
  socket.emit('init', {
    avatars: Array.from(avatars.values()),
    battleRoyaleActive,
    battleRoyaleZone,
    config
  });

  socket.on('chatCommand', (data) => {
    handleChatCommand(data.username, data.command, data.platform || 'admin');
  });

  socket.on('disconnect', () => {
    // console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// ---------------------------------------------------------------------------
// Broadcast State (throttled)
// ---------------------------------------------------------------------------
let lastBroadcast = 0;
const BROADCAST_INTERVAL = 16; // ~60fps cap for state broadcasts

function broadcastState() {
  const now = Date.now();
  if (now - lastBroadcast < BROADCAST_INTERVAL) return;
  lastBroadcast = now;

  io.emit('stateUpdate', {
    avatars: Array.from(avatars.values()),
    battleRoyaleActive,
    battleRoyaleZone
  });
}

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Avatar Stream System v1.0            ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Overlay:  http://localhost:${PORT}/overlay  ║`);
  console.log(`║  Admin:    http://localhost:${PORT}/admin    ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Twitch:   ' + (config.twitch.enabled ? 'Aktiviert' : 'Deaktiviert') + '                  ║');
  console.log('║  Kick:     ' + (config.kick.enabled ? 'Simulator aktiv' : 'Deaktiviert') + '             ║');
  console.log('╚══════════════════════════════════════════╝');

  // Auto-connect Twitch if enabled
  if (config.twitch.enabled) {
    connectTwitch();
  }
  if (config.kick.enabled) {
    startKickSimulator();
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  disconnectTwitch();
  stopKickSimulator();
  server.close();
  process.exit(0);
});
