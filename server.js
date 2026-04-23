// ============================================================================
// Avatar Stream System - Server v0.0.3
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
// Connection Status
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

app.get('/overlay', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'overlay', 'index.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

// ---------------------------------------------------------------------------
// Avatar Registry (minimal — just tracks who exists)
// ---------------------------------------------------------------------------
const avatarRegistry = new Map(); // username -> { id, username, platform, color, hp, maxHp, width, height, state }

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
  if (avatarRegistry.has(key)) return avatarRegistry.get(key);

  const colorIndex = avatarRegistry.size % AVATAR_COLORS.length;
  const avatar = {
    id: key,
    username: username,
    platform: platform,
    color: AVATAR_COLORS[colorIndex],
    hp: 100,
    maxHp: 100,
    width: config.avatar.size,
    height: config.avatar.size,
    state: 'idle'
  };

  avatarRegistry.set(key, avatar);

  // Tell overlay to create avatar with initial position
  io.emit('avatarCreate', {
    id: key,
    username: username,
    platform: platform,
    color: avatar.color,
    width: avatar.width,
    height: avatar.height,
    speed: config.avatar.defaultSpeed
  });

  return avatar;
}

function removeAvatar(username) {
  const key = username.toLowerCase();
  if (avatarRegistry.has(key)) {
    avatarRegistry.delete(key);
    io.emit('avatarRemove', { id: key });
  }
}

// ---------------------------------------------------------------------------
// Battle Royale Logic
// ---------------------------------------------------------------------------
let battleRoyaleActive = false;

function startBattleRoyale() {
  if (avatarRegistry.size < 2) return false;
  battleRoyaleActive = true;
  // Reset all HP
  for (const avatar of avatarRegistry.values()) {
    avatar.hp = 100;
    avatar.maxHp = 100;
    avatar.state = 'idle';
  }
  io.emit('battleRoyaleStart', {
    zone: { x: 0, y: 0, width: config.overlay.width, height: config.overlay.height }
  });
  broadcastRegistry();
  return true;
}

function stopBattleRoyale() {
  battleRoyaleActive = false;
  for (const avatar of avatarRegistry.values()) {
    if (avatar.state === 'dead') {
      avatar.hp = 100;
      avatar.maxHp = 100;
      avatar.state = 'idle';
    }
  }
  io.emit('battleRoyaleEnd');
  broadcastRegistry();
}

function nukeAll() {
  const explosionList = [];
  for (const [id, avatar] of avatarRegistry) {
    // We don't know x/y on server — overlay handles it
    explosionList.push({ id, color: avatar.color });
  }
  avatarRegistry.clear();
  battleRoyaleActive = false;
  io.emit('nuke', { avatars: explosionList });
}

// ---------------------------------------------------------------------------
// Chat Command Handler — EMITS COMMANDS TO OVERLAY, NOT STATE
// ---------------------------------------------------------------------------
function handleChatCommand(username, command, platform) {
  const rawCmd = command.trim();
  const parts = rawCmd.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Log chat messages
  if (cmd.startsWith('!')) {
    io.emit('chatMessage', { username, command: rawCmd, platform, timestamp: Date.now() });
  }

  const key = username.toLowerCase();

  // --- !join (creates avatar) ---
  if (cmd === config.commands.join || cmd === '!join') {
    const avatar = createAvatar(username, platform);
    addLog(`[Chat] ${username} joined (${platform})`, platform);
    return;
  }

  // All commands below require an existing avatar
  const avatar = avatarRegistry.get(key);
  if (!avatar) return;

  // --- Command dispatch to overlay ---
  switch (cmd) {
    case '!jump':
    case config.commands.jump:
      io.emit('avatarCommand', { id: key, command: 'jump' });
      break;

    case '!dance':
    case config.commands.dance:
      io.emit('avatarCommand', { id: key, command: 'dance' });
      break;

    case '!attack':
    case config.commands.attack:
      if (battleRoyaleActive) {
        io.emit('avatarCommand', { id: key, command: 'attack' });
      }
      break;

    case '!color':
    case '!farbe':
      if (args.length > 0) {
        const colorArg = args[0].toLowerCase();
        let newColor = null;
        if (NAMED_COLORS[colorArg]) {
          newColor = NAMED_COLORS[colorArg];
        } else if (/^#[0-9a-f]{3,8}$/i.test(colorArg)) {
          newColor = colorArg;
        } else if (/^[0-9a-f]{6}$/i.test(colorArg)) {
          newColor = '#' + colorArg;
        }
        if (newColor) {
          avatar.color = newColor;
          io.emit('avatarCommand', { id: key, command: 'color', value: newColor });
        }
      }
      break;

    case '!leave':
    case '!quit':
    case '!raus':
      removeAvatar(username);
      io.emit('chatMessage', { username: 'System', command: `${username} hat den Stream verlassen`, platform: 'system', timestamp: Date.now() });
      break;

    case '!heal':
    case '!heilen':
      avatar.hp = Math.min(avatar.maxHp, avatar.hp + 20);
      io.emit('avatarCommand', { id: key, command: 'heal', value: 20 });
      break;

    case '!speed':
    case '!tempo':
      if (args.length > 0) {
        const spd = parseInt(args[0]);
        if (spd >= 1 && spd <= 5) {
          io.emit('avatarCommand', { id: key, command: 'speed', value: spd });
        }
      }
      break;

    case '!grow':
    case '!wachsen':
      avatar.width = Math.min(128, avatar.width + 8);
      avatar.height = Math.min(128, avatar.height + 8);
      io.emit('avatarCommand', { id: key, command: 'grow' });
      break;

    case '!shrink':
    case '!kleiner':
      avatar.width = Math.max(24, avatar.width - 8);
      avatar.height = Math.max(24, avatar.height - 8);
      io.emit('avatarCommand', { id: key, command: 'shrink' });
      break;

    case '!wave':
    case '!winken':
      io.emit('avatarCommand', { id: key, command: 'wave' });
      break;

    case '!sit':
    case '!setzen':
      io.emit('avatarCommand', { id: key, command: 'sit' });
      break;

    case '!flip':
    case '!drehen':
      io.emit('avatarCommand', { id: key, command: 'flip' });
      break;

    case '!emote':
    case '!say':
      if (args.length > 0) {
        const text = args.join(' ').substring(0, 30);
        io.emit('avatarCommand', { id: key, command: 'emote', value: text });
      }
      break;

    case '!reset':
      avatar.hp = 100;
      avatar.maxHp = 100;
      avatar.width = config.avatar.size;
      avatar.height = config.avatar.size;
      avatar.color = AVATAR_COLORS[avatarRegistry.size % AVATAR_COLORS.length];
      avatar.state = 'idle';
      io.emit('avatarCommand', { id: key, command: 'reset', value: { hp: 100, width: config.avatar.size, height: config.avatar.size, color: avatar.color } });
      break;
  }

  broadcastRegistry();
}

// Minimal log helper
function addLog(msg, platform) {
  console.log(msg);
}

// ---------------------------------------------------------------------------
// Twitch Chat (tmi.js) — FIXED: anonymous login
// ---------------------------------------------------------------------------
let twitchClient = null;

function connectTwitch() {
  if (twitchClient) disconnectTwitch();

  const channels = config.twitch.channels.filter(c => c && c.trim() !== '' && c !== 'dein_twitch_kanal');
  if (channels.length === 0) {
    connStatus.twitch = { connected: false, channel: '', error: 'Kein gueltiger Kanal konfiguriert' };
    broadcastStatus();
    return;
  }

  twitchClient = new tmi.Client({
    options: { debug: false },
    connection: {
      reconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 15,
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

  twitchClient.on('connected', (addr) => {
    console.log('[Twitch] Connected to', addr, '- Channels:', channels.join(', '));
    connStatus.twitch = { connected: true, channel: channels.join(', '), error: null };
    broadcastStatus();
  });

  twitchClient.on('disconnected', (reason) => {
    console.log('[Twitch] Disconnected:', reason);
    connStatus.twitch = { connected: false, channel: channels.join(', '), error: reason || 'Disconnected' };
    broadcastStatus();
  });

  twitchClient.on('connecting', () => console.log('[Twitch] Connecting...'));
  twitchClient.on('join', (channel, username, self) => { if (self) console.log('[Twitch] Joined:', channel); });

  twitchClient.connect().catch(err => {
    console.error('[Twitch] Error:', err.message);
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
// Kick Chat — Pusher WebSocket + Polling Fallback
// ---------------------------------------------------------------------------
let kickWs = null;
let kickPollInterval = null;
let kickLastMessageIds = new Set(); // Track last N message IDs to avoid duplicates

function connectKick() {
  const channel = config.kick.channel;
  if (!channel || channel.trim() === '' || channel === 'dein_kick_kanal') {
    connStatus.kick = { connected: false, channel: '', error: 'Kein Kanal konfiguriert', mode: 'simulator' };
    broadcastStatus();
    return;
  }

  disconnectKick();
  console.log('[Kick] Connecting to channel:', channel);

  // Step 1: Resolve chatroom ID from Kick API
  const apiUrl = `https://kick.com/api/v2/channels/${channel}`;

  const req = https.get(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    }
  }, (res) => {
    // Handle redirects
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      https.get(res.headers.location, (res2) => {
        let data2 = '';
        res2.on('data', chunk => data2 += chunk);
        res2.on('end', () => processKickApiResponse(data2, channel));
      }).on('error', (e) => {
        console.error('[Kick] Redirect error:', e.message);
        startKickPolling(channel);
      });
      return;
    }

    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => processKickApiResponse(data, channel));
  });

  req.on('error', (e) => {
    console.error('[Kick] API error:', e.message);
    startKickPolling(channel);
  });

  req.setTimeout(10000, () => {
    req.destroy();
    console.error('[Kick] API timeout');
    startKickPolling(channel);
  });
}

function processKickApiResponse(data, channel) {
  try {
    const json = JSON.parse(data);
    // Try multiple possible paths
    const chatroomId = json.data?.chatroom_id || json.data?.chatroom?.id || json.chatroom_id;

    if (!chatroomId) {
      console.error('[Kick] No chatroom ID found for:', channel);
      connStatus.kick = { connected: false, channel, error: 'Chatroom-ID nicht gefunden', mode: 'simulator' };
      broadcastStatus();
      startKickPolling(channel);
      return;
    }

    console.log('[Kick] Chatroom ID:', chatroomId, '- Starting Pusher');
    connectKickPusher(chatroomId, channel);

  } catch (e) {
    console.error('[Kick] API parse error:', e.message);
    connStatus.kick = { connected: false, channel, error: 'API-Fehler', mode: 'simulator' };
    broadcastStatus();
    startKickPolling(channel);
  }
}

function connectKickPusher(chatroomId, channel) {
  try {
    const WebSocket = require('ws');

    // Pusher connection with proper protocol
    const PUSHER_KEY = '32cbd69e03eb5b3ee65a';
    const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=7.6.0&flash=false`;

    kickWs = new WebSocket(PUSHER_URL);

    kickWs.on('open', () => {
      console.log('[Kick] Pusher connected');
      kickWs.send(JSON.stringify({
        event: 'pusher:subscribe',
        data: { channel: `chatrooms.${chatroomId}.v2` }
      }));
      connStatus.kick = { connected: true, channel, error: null, mode: 'pusher' };
      broadcastStatus();
    });

    kickWs.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        // Handle pusher internal events
        if (msg.event === 'pusher:connection_established') {
          console.log('[Kick] Pusher handshake OK');
          return;
        }
        if (msg.event === 'pusher_internal:subscription_succeeded') {
          console.log('[Kick] Subscribed to chatroom');
          return;
        }

        // Handle chat messages
        if (msg.event === 'App\\Events\\ChatMessageEvent' || msg.event === 'App\\Events\\MessageEvent') {
          const chatData = JSON.parse(msg.data);
          const chatMsg = chatData.content || chatData.message || '';
          const username = chatData.sender?.username || chatData.username || 'Unknown';

          if (chatMsg.startsWith('!')) {
            handleChatCommand(username, chatMsg, 'kick');
          }
        }
      } catch (e) {
        // Ignore non-JSON or parse errors
      }
    });

    kickWs.on('error', (e) => {
      console.error('[Kick] WebSocket error:', e.message);
      connStatus.kick = { connected: false, channel, error: 'WebSocket-Fehler', mode: 'simulator' };
      broadcastStatus();
    });

    kickWs.on('close', () => {
      console.log('[Kick] WebSocket closed');
      connStatus.kick = { connected: false, channel, error: 'Geschlossen', mode: 'simulator' };
      broadcastStatus();
      // Auto-reconnect
      if (config.kick.enabled) {
        setTimeout(() => { if (config.kick.enabled) connectKick(); }, 5000);
      }
    });

    // Ping to keep connection alive
    const pingInterval = setInterval(() => {
      if (kickWs && kickWs.readyState === 1) {
        kickWs.send(JSON.stringify({ event: 'pusher:ping', data: '{}' }));
      } else {
        clearInterval(pingInterval);
      }
    }, 120000);

  } catch (e) {
    console.error('[Kick] Pusher init error:', e.message);
    console.log('[Kick] Falling back to polling');
    startKickPolling(channel);
  }
}

function startKickPolling(channel) {
  if (kickPollInterval) clearInterval(kickPollInterval);

  connStatus.kick = { connected: true, channel, error: null, mode: 'polling' };
  broadcastStatus();
  console.log('[Kick] Polling mode for:', channel);

  // Initial fetch to populate message IDs
  fetchKickMessages(channel, true);

  // Poll every 3 seconds
  kickPollInterval = setInterval(() => fetchKickMessages(channel, false), 3000);
}

function fetchKickMessages(channel, initial) {
  const apiUrl = `https://kick.com/api/v2/channels/${channel}/messages`;

  https.get(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const messages = json.data?.messages || json.data || [];

        for (const msg of messages) {
          const msgId = msg.id || msg.message_id || msg.timestamp;
          if (msgId && kickLastMessageIds.has(msgId)) continue;

          const content = msg.content || '';
          const username = msg.sender?.username || msg.username || 'Unknown';

          if (!initial && content.startsWith('!')) {
            handleChatCommand(username, content, 'kick');
          }

          if (msgId) {
            kickLastMessageIds.add(msgId);
            // Keep only last 50 IDs
            if (kickLastMessageIds.size > 50) {
              const arr = Array.from(kickLastMessageIds);
              kickLastMessageIds = new Set(arr.slice(-50));
            }
          }
        }
      } catch (e) {}
    });
  }).on('error', () => {});
}

function disconnectKick() {
  if (kickWs) { try { kickWs.close(); } catch {} kickWs = null; }
  if (kickPollInterval) { clearInterval(kickPollInterval); kickPollInterval = null; }
  kickLastMessageIds.clear();
  connStatus.kick = { connected: false, channel: '', error: null, mode: 'simulator' };
  broadcastStatus();
}

// Kick simulator API (always available)
app.post('/api/kick-sim', (req, res) => {
  const { username, message } = req.body;
  if (!username || !message) return res.status(400).json({ error: 'username and message required' });
  handleChatCommand(username, message, 'kick');
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------
app.get('/api/state', (_req, res) => {
  res.json({
    avatars: Array.from(avatarRegistry.values()),
    battleRoyaleActive,
    connStatus,
    config
  });
});

app.get('/api/conn-status', (_req, res) => res.json(connStatus));

app.post('/api/spawn-test', (req, res) => {
  const name = req.body.username || `TestUser_${Math.floor(Math.random() * 999)}`;
  const avatar = createAvatar(name, 'test');
  res.json({ success: true, avatar });
});

app.post('/api/battle-royale', (req, res) => {
  if (req.body.action === 'start') {
    const result = startBattleRoyale();
    res.json({ success: result, message: result ? 'Battle Royale gestartet!' : 'Mindestens 2 Avatare noetig!' });
  } else {
    stopBattleRoyale();
    res.json({ success: true, message: 'Battle Royale beendet!' });
  }
});

app.post('/api/nuke', (_req, res) => {
  nukeAll();
  res.json({ success: true, message: 'Nuke ausgeloest!' });
});

app.post('/api/remove-avatar', (req, res) => {
  removeAvatar(req.body.username);
  res.json({ success: true });
});

app.post('/api/clear-all', (_req, res) => {
  avatarRegistry.clear();
  battleRoyaleActive = false;
  io.emit('clearAll');
  res.json({ success: true });
});

app.post('/api/config', (req, res) => {
  for (const key of Object.keys(req.body)) {
    if (typeof req.body[key] === 'object' && !Array.isArray(req.body[key]) && config[key]) {
      config[key] = { ...config[key], ...req.body[key] };
    } else {
      config[key] = req.body[key];
    }
  }
  saveConfig();
  res.json({ success: true, config });
});

app.post('/api/twitch/connect', (req, res) => {
  if (req.body.channel) {
    config.twitch.channels = [req.body.channel];
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

app.post('/api/kick/connect', (req, res) => {
  if (req.body.channel) {
    config.kick.channel = req.body.channel;
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
    res.json({ sprites: fs.readdirSync(spritesDir).filter(f => f.endsWith('.png') || f.endsWith('.json')) });
  } catch { res.json({ sprites: [] }); }
});

// ---------------------------------------------------------------------------
// Socket.io Events
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.emit('init', {
    avatars: Array.from(avatarRegistry.values()),
    battleRoyaleActive,
    connStatus,
    config
  });
  socket.emit('connStatus', connStatus);

  socket.on('chatCommand', (data) => {
    handleChatCommand(data.username, data.command, data.platform || 'admin');
  });

  // Overlay reports its state back for admin display
  socket.on('overlayState', (data) => {
    // Forward to admin panel clients
    socket.broadcast.emit('overlayStateUpdate', data);
  });
});

// ---------------------------------------------------------------------------
// Broadcast Registry (for admin panel, throttled)
// ---------------------------------------------------------------------------
let lastBroadcast = 0;
function broadcastRegistry() {
  const now = Date.now();
  if (now - lastBroadcast < 200) return; // 5 Hz max for admin
  lastBroadcast = now;
  io.emit('registryUpdate', {
    avatars: Array.from(avatarRegistry.values()),
    battleRoyaleActive
  });
}

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('');
  console.log('  ============================================');
  console.log('    Avatar Stream System v0.0.3');
  console.log('  ============================================');
  console.log(`    Overlay:  http://localhost:${PORT}/overlay`);
  console.log(`    Admin:    http://localhost:${PORT}/admin`);
  console.log('');
  console.log('    Commands: !join !jump !dance !attack');
  console.log('              !color !heal !speed !grow !shrink');
  console.log('              !wave !sit !flip !emote !leave !reset');
  console.log('  ============================================');
  console.log('');

  if (config.twitch.enabled && config.twitch.channels?.length > 0) {
    const valid = config.twitch.channels.filter(c => c && c !== 'dein_twitch_kanal');
    if (valid.length > 0) connectTwitch();
  }
  if (config.kick.enabled && config.kick.channel && config.kick.channel !== 'dein_kick_kanal') {
    connectKick();
  }
});

process.on('SIGINT', () => {
  disconnectTwitch();
  disconnectKick();
  server.close();
  process.exit(0);
});
