// ============================================================================
// Avatar Stream System - Server v0.0.2
// ============================================================================
const fs = require('fs');
const path = require('path');
const https = require('https');
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
// Connection Status (shared state)
// ---------------------------------------------------------------------------
const connStatus = {
  twitch: { connected: false, channel: '', error: null },
  kick: { connected: false, channel: '', error: null, mode: 'simulator' }
};

function broadcastStatus() {
  io.emit('connStatus', connStatus);
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

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/overlay', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay', 'index.html'));
});
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ---------------------------------------------------------------------------
// Avatar State
// ---------------------------------------------------------------------------
const avatars = new Map();
let battleRoyaleActive = false;
let battleRoyaleZone = null;

const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F1948A', '#AED6F1', '#D7BDE2',
  '#A3E4D7', '#FAD7A0', '#A9CCE3', '#D5F5E3', '#FADBD8'
];

const NAMED_COLORS = {
  red: '#FF4444', blue: '#4488FF', green: '#44FF44', yellow: '#FFFF44',
  pink: '#FF44FF', orange: '#FF8844', purple: '#8844FF', cyan: '#44FFFF',
  white: '#FFFFFF', black: '#333333', gold: '#FFD700', lime: '#44FF88',
  crimson: '#DC143C', violet: '#8B00FF', teal: '#008080', coral: '#FF7F50'
};

function createAvatar(username, platform = 'twitch') {
  const key = username.toLowerCase();
  if (avatars.has(key)) {
    return avatars.get(key);
  }

  const colorIndex = avatars.size % AVATAR_COLORS.length;
  const avatar = {
    id: key,
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
    state: 'idle',
    animFrame: 0,
    animTimer: 0,
    attackCooldown: 0,
    targetId: null,
    spawnTime: Date.now(),
    spriteName: null,
    speed: config.avatar.defaultSpeed,
    emote: null,
    emoteTimer: 0
  };

  avatars.set(key, avatar);
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
    x: 0, y: 0,
    width: config.overlay.width,
    height: config.overlay.height
  };

  for (const avatar of avatars.values()) {
    avatar.hp = 100;
    avatar.maxHp = 100;
    avatar.state = 'idle';
    avatar.targetId = null;
    avatar.attackCooldown = 0;
    avatar.x = 100 + Math.random() * (config.overlay.width - 200);
    avatar.y = config.overlay.height - 100 - avatar.height;
    avatar.vx = (Math.random() - 0.5) * 4;
  }

  io.emit('battleRoyaleStart', { zone: battleRoyaleZone });
  broadcastState();
  return true;
}

function stopBattleRoyale() {
  battleRoyaleActive = false;
  battleRoyaleZone = null;
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
// Chat Command Handler (EXPANDED)
// ---------------------------------------------------------------------------
function handleChatCommand(username, command, platform) {
  const rawCmd = command.trim();
  const parts = rawCmd.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Log every chat message for visibility
  if (cmd.startsWith('!')) {
    io.emit('chatMessage', { username, command: rawCmd, platform, timestamp: Date.now() });
  }

  // --- !join ---
  if (cmd === config.commands.join) {
    const avatar = createAvatar(username, platform);
    io.emit('avatarJoined', { username, platform, color: avatar.color, x: avatar.x, y: avatar.y });
    return;
  }

  // All commands below require an existing avatar
  const avatar = avatars.get(username.toLowerCase());
  if (!avatar || avatar.state === 'dead') return;

  switch (cmd) {
    // --- !jump ---
    case config.commands.jump:
      if (!avatar.isJumping) {
        avatar.isJumping = true;
        avatar.jumpStartTime = Date.now();
        avatar.state = 'jumping';
        io.emit('avatarJumped', { username: avatar.username });
      }
      break;

    // --- !attack ---
    case config.commands.attack:
      if (battleRoyaleActive && avatar.attackCooldown <= 0) {
        avatar.state = 'attacking';
        avatar.attackCooldown = config.battleRoyale.attackCooldown;
        setTimeout(() => {
          if (avatar.state === 'attacking') avatar.state = 'idle';
        }, 300);
      }
      break;

    // --- !dance ---
    case config.commands.dance:
      avatar.state = 'dancing';
      setTimeout(() => {
        if (avatar.state === 'dancing') avatar.state = 'idle';
      }, 3000);
      break;

    // --- !color <color> ---
    case '!color':
    case '!farbe':
      if (args.length > 0) {
        const colorArg = args[0].toLowerCase();
        if (NAMED_COLORS[colorArg]) {
          avatar.color = NAMED_COLORS[colorArg];
        } else if (/^#[0-9a-f]{3,8}$/i.test(colorArg)) {
          avatar.color = colorArg;
        } else if (/^[0-9a-f]{6}$/i.test(colorArg)) {
          avatar.color = '#' + colorArg;
        }
      }
      break;

    // --- !leave / !leave ---
    case '!leave':
    case '!quit':
    case '!raus':
      removeAvatar(username);
      io.emit('avatarLeft', { username });
      break;

    // --- !heal ---
    case '!heal':
    case '!heilen':
      if (avatar.hp < avatar.maxHp) {
        avatar.hp = Math.min(avatar.maxHp, avatar.hp + 20);
        avatar.emote = '+20 HP';
        avatar.emoteTimer = 1000;
      }
      break;

    // --- !speed <1-5> ---
    case '!speed':
    case '!tempo':
      if (args.length > 0) {
        const spd = parseInt(args[0]);
        if (spd >= 1 && spd <= 5) {
          avatar.speed = config.avatar.defaultSpeed * spd;
          avatar.vx = Math.sign(avatar.vx || 1) * avatar.speed;
        }
      }
      break;

    // --- !grow ---
    case '!grow':
    case '!wachsen': {
      const newSize = Math.min(128, avatar.width + 8);
      avatar.width = newSize;
      avatar.height = newSize;
      break;
    }

    // --- !shrink ---
    case '!shrink':
    case '!kleiner': {
      const shrinkSize = Math.max(24, avatar.width - 8);
      avatar.width = shrinkSize;
      avatar.height = shrinkSize;
      break;
    }

    // --- !wave ---
    case '!wave':
    case '!winken':
      avatar.state = 'waving';
      avatar.emote = 'Wink!';
      avatar.emoteTimer = 1500;
      setTimeout(() => {
        if (avatar.state === 'waving') avatar.state = 'idle';
      }, 1500);
      break;

    // --- !sit ---
    case '!sit':
    case '!setzen':
      avatar.state = 'sitting';
      avatar.vx = 0;
      setTimeout(() => {
        if (avatar.state === 'sitting') avatar.state = 'idle';
      }, 3000);
      break;

    // --- !flip ---
    case '!flip':
    case '!drehen':
      avatar.direction *= -1;
      break;

    // --- !emote <text> ---
    case '!emote':
    case '!say':
      if (args.length > 0) {
        avatar.emote = args.join(' ').substring(0, 30);
        avatar.emoteTimer = 2500;
      }
      break;

    // --- !reset ---
    case '!reset':
      avatar.hp = 100;
      avatar.maxHp = 100;
      avatar.width = config.avatar.size;
      avatar.height = config.avatar.size;
      avatar.speed = config.avatar.defaultSpeed;
      avatar.state = 'idle';
      avatar.color = AVATAR_COLORS[avatars.size % AVATAR_COLORS.length];
      break;
  }

  broadcastState();
}

// ---------------------------------------------------------------------------
// Twitch Chat (tmi.js) — FIXED: anonymous login with justinfan identity
// ---------------------------------------------------------------------------
let twitchClient = null;

function connectTwitch() {
  if (twitchClient) {
    disconnectTwitch();
  }

  const channels = config.twitch.channels.filter(c => c && c.trim() !== '' && c !== 'dein_twitch_kanal');
  if (channels.length === 0) {
    connStatus.twitch = { connected: false, channel: '', error: 'Kein gueltiger Kanal konfiguriert' };
    broadcastStatus();
    return;
  }

  // IMPORTANT: Anonymous login requires a justinfan username + dummy oauth
  twitchClient = new tmi.Client({
    options: { debug: false, messagesLogLevel: 'info' },
    connection: {
      reconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      secure: true
    },
    identity: {
      username: 'justinfan' + Math.floor(Math.random() * 99999),
      password: 'oauth:1234567890'
    },
    channels: channels.map(c => c.startsWith('#') ? c : '#' + c)
  });

  twitchClient.on('message', (channel, tags, message, self) => {
    if (self) return;
    const username = tags['display-name'] || tags.username || 'Unknown';
    handleChatCommand(username, message, 'twitch');
  });

  twitchClient.on('connected', (addr, port) => {
    console.log('[Twitch] Connected to', addr, port, '- Channels:', channels.join(', '));
    connStatus.twitch = { connected: true, channel: channels.join(', '), error: null };
    broadcastStatus();
  });

  twitchClient.on('disconnected', (reason) => {
    console.log('[Twitch] Disconnected:', reason);
    connStatus.twitch = { connected: false, channel: channels.join(', '), error: reason || 'Disconnected' };
    broadcastStatus();
  });

  twitchClient.on('connecting', () => {
    console.log('[Twitch] Connecting to channels:', channels.join(', '));
  });

  twitchClient.on('reconnect', () => {
    console.log('[Twitch] Reconnecting...');
  });

  twitchClient.on('join', (channel, username, self) => {
    if (self) {
      console.log('[Twitch] Joined channel:', channel);
    }
  });

  twitchClient.connect().catch(err => {
    console.error('[Twitch] Connection error:', err.message);
    connStatus.twitch = { connected: false, channel: channels.join(', '), error: err.message };
    broadcastStatus();
  });
}

function disconnectTwitch() {
  if (twitchClient) {
    twitchClient.disconnect().catch(() => {});
    twitchClient = null;
  }
  connStatus.twitch = { connected: false, channel: '', error: null };
  broadcastStatus();
}

// ---------------------------------------------------------------------------
// Kick Chat Reader — Pusher WebSocket Integration
// ---------------------------------------------------------------------------
let kickWs = null;
let kickPollInterval = null;
let kickLastMessageId = null;

function connectKick() {
  const channel = config.kick.channel;
  if (!channel || channel.trim() === '' || channel === 'dein_kick_kanal') {
    connStatus.kick = { connected: false, channel: '', error: 'Kein gueltiger Kanal konfiguriert', mode: 'simulator' };
    broadcastStatus();
    return;
  }

  disconnectKick();

  console.log('[Kick] Connecting to channel:', channel);

  // Step 1: Get chatroom ID from Kick API
  const apiUrl = `https://kick.com/api/v2/channels/${channel}`;

  https.get(apiUrl, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const chatroomId = json.data?.chatroom_id || json.data?.chatroom?.id;

        if (!chatroomId) {
          console.error('[Kick] Could not find chatroom ID for channel:', channel);
          connStatus.kick = { connected: false, channel, error: 'Chatroom-ID nicht gefunden', mode: 'simulator' };
          broadcastStatus();
          // Fallback to polling
          startKickPolling(channel);
          return;
        }

        console.log('[Kick] Found chatroom ID:', chatroomId, '- Starting Pusher connection');
        connectKickPusher(chatroomId, channel);

      } catch (e) {
        console.error('[Kick] API parse error:', e.message);
        connStatus.kick = { connected: false, channel, error: 'API-Fehler: ' + e.message, mode: 'simulator' };
        broadcastStatus();
        startKickPolling(channel);
      }
    });
  }).on('error', (e) => {
    console.error('[Kick] API request error:', e.message);
    connStatus.kick = { connected: false, channel, error: 'Verbindungsfehler: ' + e.message, mode: 'simulator' };
    broadcastStatus();
    startKickPolling(channel);
  });
}

function connectKickPusher(chatroomId, channel) {
  try {
    // Use Pusher WebSocket protocol
    const WebSocket = require('ws');
    const PUSHER_KEY = '32cbd69e03eb5b3ee65a';
    const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=7.6.0&flash=false`;

    kickWs = new WebSocket(PUSHER_URL);

    kickWs.on('open', () => {
      console.log('[Kick] Pusher WebSocket connected');
      // Subscribe to chatroom channel
      const subscribeMsg = JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: `chatrooms.${chatroomId}.v2` }
      });
      kickWs.send(subscribeMsg);

      connStatus.kick = { connected: true, channel, error: null, mode: 'pusher' };
      broadcastStatus();
    });

    kickWs.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData);
        if (msg.event === 'App\\Events\\ChatMessageEvent' || msg.event === 'App\\Events\\MessageEvent') {
          const chatData = JSON.parse(msg.data);
          const chatMsg = chatData.content || chatData.message || '';
          const username = chatData.sender?.username || chatData.username || 'Unknown';

          if (chatMsg.startsWith('!')) {
            handleChatCommand(username, chatMsg, 'kick');
          }
        }
      } catch (e) {
        // Ignore parse errors for non-chat messages
      }
    });

    kickWs.on('error', (e) => {
      console.error('[Kick] WebSocket error:', e.message);
      connStatus.kick = { connected: false, channel, error: 'WebSocket-Fehler', mode: 'simulator' };
      broadcastStatus();
    });

    kickWs.on('close', () => {
      console.log('[Kick] WebSocket closed');
      connStatus.kick = { connected: false, channel, error: 'Verbindung geschlossen', mode: 'simulator' };
      broadcastStatus();

      // Auto-reconnect after 5 seconds
      if (config.kick.enabled) {
        setTimeout(() => {
          if (config.kick.enabled) connectKick();
        }, 5000);
      }
    });

  } catch (e) {
    console.error('[Kick] Pusher init error (ws module missing?):', e.message);
    console.log('[Kick] Falling back to polling mode');
    startKickPolling(channel);
  }
}

// Fallback: Polling mode (less reliable but works without ws module)
function startKickPolling(channel) {
  if (kickPollInterval) clearInterval(kickPollInterval);

  connStatus.kick = { connected: true, channel, error: null, mode: 'polling' };
  broadcastStatus();

  console.log('[Kick] Starting polling mode for channel:', channel);

  kickPollInterval = setInterval(() => {
    const apiUrl = `https://kick.com/api/v2/channels/${channel}/messages`;

    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const messages = json.data?.messages || json.data || [];

          for (const msg of messages) {
            const msgId = msg.id || msg.message_id;
            if (msgId && msgId === kickLastMessageId) continue;

            const content = msg.content || '';
            const username = msg.sender?.username || msg.username || 'Unknown';

            if (content.startsWith('!')) {
              handleChatCommand(username, content, 'kick');
            }

            if (msgId) kickLastMessageId = msgId;
          }
        } catch (e) {
          // Silently ignore parse errors during polling
        }
      });
    }).on('error', () => {
      // Silently ignore polling errors
    });
  }, 3000); // Poll every 3 seconds
}

function disconnectKick() {
  if (kickWs) {
    try { kickWs.close(); } catch {}
    kickWs = null;
  }
  if (kickPollInterval) {
    clearInterval(kickPollInterval);
    kickPollInterval = null;
  }
  connStatus.kick = { connected: false, channel: '', error: null, mode: 'simulator' };
  broadcastStatus();
}

// API endpoint for Kick chat simulation (always available)
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
    connStatus,
    config
  });
});

app.get('/api/conn-status', (_req, res) => {
  res.json(connStatus);
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
  res.json({ success: true, message: 'Nuke ausgeloest! Alle Avatare zerstoert!' });
});

app.post('/api/remove-avatar', (req, res) => {
  removeAvatar(req.body.username);
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
  // Deep merge
  for (const key of Object.keys(newConfig)) {
    if (typeof newConfig[key] === 'object' && !Array.isArray(newConfig[key]) && config[key]) {
      config[key] = { ...config[key], ...newConfig[key] };
    } else {
      config[key] = newConfig[key];
    }
  }
  saveConfig();
  res.json({ success: true, config });
});

// Twitch connect/disconnect with channel config
app.post('/api/twitch/connect', (req, res) => {
  const { channel } = req.body;
  if (channel) {
    config.twitch.channels = [channel];
    config.twitch.enabled = true;
    saveConfig();
  }
  connectTwitch();
  res.json({ success: true });
});

app.post('/api/twitch/disconnect', (_req, res) => {
  disconnectTwitch();
  res.json({ success: true });
});

// Kick connect/disconnect with channel config
app.post('/api/kick/connect', (req, res) => {
  const { channel } = req.body;
  if (channel) {
    config.kick.channel = channel;
    config.kick.enabled = true;
    saveConfig();
  }
  connectKick();
  res.json({ success: true });
});

app.post('/api/kick/disconnect', (_req, res) => {
  config.kick.enabled = false;
  saveConfig();
  disconnectKick();
  res.json({ success: true });
});

app.get('/api/sprites', (_req, res) => {
  const spritesDir = path.join(__dirname, 'public', 'sprites', 'avatars');
  try {
    const files = fs.readdirSync(spritesDir).filter(f => f.endsWith('.png') || f.endsWith('.json'));
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

  socket.emit('init', {
    avatars: Array.from(avatars.values()),
    battleRoyaleActive,
    battleRoyaleZone,
    connStatus,
    config
  });

  socket.emit('connStatus', connStatus);

  socket.on('chatCommand', (data) => {
    handleChatCommand(data.username, data.command, data.platform || 'admin');
  });

  socket.on('disconnect', () => {});
});

// ---------------------------------------------------------------------------
// Broadcast State (throttled)
// ---------------------------------------------------------------------------
let lastBroadcast = 0;
const BROADCAST_INTERVAL = 16;

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
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║       Avatar Stream System v0.0.2               ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Overlay:  http://localhost:${PORT}/overlay          ║`);
  console.log(`  ║  Admin:    http://localhost:${PORT}/admin            ║`);
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log('  ║  Chat-Befehle:                                   ║');
  console.log('  ║    !join  !jump  !dance  !attack                 ║');
  console.log('  ║    !color <farbe>  !leave  !heal                 ║');
  console.log('  ║    !speed <1-5>  !grow  !shrink                  ║');
  console.log('  ║    !wave  !sit  !flip  !emote <text>  !reset     ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');

  // Auto-connect if channels are configured
  if (config.twitch.enabled && config.twitch.channels.length > 0) {
    const validChannels = config.twitch.channels.filter(c => c && c !== 'dein_twitch_kanal');
    if (validChannels.length > 0) connectTwitch();
  }
  if (config.kick.enabled && config.kick.channel && config.kick.channel !== 'dein_kick_kanal') {
    connectKick();
  }
});

process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  disconnectTwitch();
  disconnectKick();
  server.close();
  process.exit(0);
});
