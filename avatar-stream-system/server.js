// ============================================================================
// Avatar Stream System - Server v0.0.3
// Twitch-only, Kick entfernt, robuste Event-Kommunikation
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
// Connection Status
// ---------------------------------------------------------------------------
const connStatus = {
  twitch: { connected: false, channel: '', error: null }
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
// Avatar State (Server-seitig)
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
    console.log(`[Avatar] ${username} existiert bereits`);
    return avatars.get(key);
  }

  const colorIndex = avatars.size % AVATAR_COLORS.length;
  const avatar = {
    id: key,
    username: username,
    platform: platform,
    color: AVATAR_COLORS[colorIndex],
    hp: 100,
    maxHp: 100,
    state: 'idle',
    speed: config.avatar.defaultSpeed,
    width: config.avatar.size,
    height: config.avatar.size,
    direction: Math.random() > 0.5 ? 1 : -1,
    spawnTime: Date.now(),
    isJumping: false,
    emote: null,
    emoteTimer: 0,
    attackCooldown: 0,
    targetId: null
  };

  avatars.set(key, avatar);

  // Sende Spawn-Event an Overlay (mit relativer Position 0-1)
  const spawnData = {
    ...avatar,
    xRatio: 0.1 + Math.random() * 0.8,  // 10%-90% der Canvas-Breite
    yRatio: 0                             // Am Boden (Overlay berechnet Ground-Y selbst)
  };

  console.log(`[Avatar] ${username} gespawnt (Farbe: ${avatar.color}, Platform: ${platform})`);
  io.emit('avatarSpawn', spawnData);
  io.emit('avatarJoined', {
    username,
    platform,
    color: avatar.color
  });

  return avatar;
}

function removeAvatar(username) {
  const key = username.toLowerCase();
  if (avatars.has(key)) {
    console.log(`[Avatar] ${username} entfernt`);
    avatars.delete(key);
    io.emit('avatarRemove', { id: key, username });
  }
}

// ---------------------------------------------------------------------------
// Battle Royale Logic
// ---------------------------------------------------------------------------
function startBattleRoyale() {
  if (avatars.size < 2) return false;
  battleRoyaleActive = true;
  battleRoyaleZone = {
    xRatio: 0, yRatio: 0,
    widthRatio: 1, heightRatio: 1
  };

  for (const avatar of avatars.values()) {
    avatar.hp = 100;
    avatar.maxHp = 100;
    avatar.state = 'idle';
    avatar.targetId = null;
    avatar.attackCooldown = 0;
    avatar.isJumping = false;
    avatar.emote = null;
    avatar.emoteTimer = 0;
  }

  io.emit('battleRoyaleStart', { zone: battleRoyaleZone });
  console.log(`[BR] Battle Royale gestartet mit ${avatars.size} Avataren`);
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
  console.log('[BR] Battle Royale beendet');
}

function nukeAll() {
  const explosionList = [];
  for (const avatar of avatars.values()) {
    explosionList.push({ id: avatar.id, color: avatar.color });
  }
  avatars.clear();
  battleRoyaleActive = false;
  battleRoyaleZone = null;
  io.emit('nuke', { explosions: explosionList });
  console.log('[NUKE] Alle Avatare vernichtet');
}

// ---------------------------------------------------------------------------
// Chat Command Handler
// ---------------------------------------------------------------------------
function handleChatCommand(username, command, platform) {
  const rawCmd = command.trim();
  const parts = rawCmd.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  // Logge alle Befehle
  if (cmd.startsWith('!')) {
    console.log(`[Chat] [${platform}] ${username}: ${rawCmd}`);
    io.emit('chatMessage', { username, command: rawCmd, platform, timestamp: Date.now() });
  }

  // --- !join ---
  if (cmd === '!join') {
    createAvatar(username, platform);
    return;
  }

  // Alle weiteren Befehle erfordern existierenden Avatar
  const key = username.toLowerCase();
  const avatar = avatars.get(key);
  if (!avatar) {
    // Avatar existiert nicht — ignoriere Befehl (ausser !join)
    return;
  }
  if (avatar.state === 'dead' && cmd !== '!reset' && cmd !== '!leave') return;

  switch (cmd) {
    // --- !jump ---
    case '!jump':
    case '!springen':
      if (!avatar.isJumping) {
        avatar.isJumping = true;
        avatar.state = 'jumping';
        io.emit('avatarAction', { id: key, action: 'jump', username: avatar.username });
        console.log(`[Action] ${username} springt`);
      }
      break;

    // --- !attack ---
    case '!attack':
    case '!angriff':
      if (battleRoyaleActive && avatar.attackCooldown <= 0) {
        avatar.state = 'attacking';
        avatar.attackCooldown = config.battleRoyale.attackCooldown;
        io.emit('avatarAction', { id: key, action: 'attack', username: avatar.username });
        setTimeout(() => {
          if (avatar.state === 'attacking') avatar.state = 'idle';
        }, 300);
        console.log(`[Action] ${username} greift an`);
      }
      break;

    // --- !dance ---
    case '!dance':
    case '!tanzen':
      avatar.state = 'dancing';
      io.emit('avatarAction', { id: key, action: 'dance', username: avatar.username });
      setTimeout(() => {
        if (avatar.state === 'dancing') avatar.state = 'idle';
      }, 3000);
      console.log(`[Action] ${username} tanzt`);
      break;

    // --- !color <color> ---
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
          io.emit('avatarAction', { id: key, action: 'color', color: newColor, username: avatar.username });
          console.log(`[Action] ${username} Farbe: ${newColor}`);
        }
      }
      break;

    // --- !leave ---
    case '!leave':
    case '!quit':
    case '!raus':
      removeAvatar(username);
      break;

    // --- !heal ---
    case '!heal':
    case '!heilen':
      if (avatar.hp < avatar.maxHp) {
        avatar.hp = Math.min(avatar.maxHp, avatar.hp + 20);
        avatar.emote = '+20 HP';
        avatar.emoteTimer = 1000;
        io.emit('avatarAction', { id: key, action: 'heal', hp: avatar.hp, username: avatar.username });
        console.log(`[Action] ${username} heilt (+20 HP → ${avatar.hp})`);
      }
      break;

    // --- !speed <1-5> ---
    case '!speed':
    case '!tempo':
      if (args.length > 0) {
        const spd = parseInt(args[0]);
        if (spd >= 1 && spd <= 5) {
          avatar.speed = config.avatar.defaultSpeed * spd;
          io.emit('avatarAction', { id: key, action: 'speed', speed: avatar.speed, username: avatar.username });
          console.log(`[Action] ${username} Tempo: ${spd}`);
        }
      }
      break;

    // --- !grow ---
    case '!grow':
    case '!wachsen': {
      const newSize = Math.min(128, avatar.width + 8);
      avatar.width = newSize;
      avatar.height = newSize;
      io.emit('avatarAction', { id: key, action: 'grow', width: newSize, height: newSize, username: avatar.username });
      console.log(`[Action] ${username} wächst (${newSize}px)`);
      break;
    }

    // --- !shrink ---
    case '!shrink':
    case '!kleiner': {
      const shrinkSize = Math.max(24, avatar.width - 8);
      avatar.width = shrinkSize;
      avatar.height = shrinkSize;
      io.emit('avatarAction', { id: key, action: 'shrink', width: shrinkSize, height: shrinkSize, username: avatar.username });
      console.log(`[Action] ${username} schrumpft (${shrinkSize}px)`);
      break;
    }

    // --- !wave ---
    case '!wave':
    case '!winken':
      avatar.state = 'waving';
      avatar.emote = 'Wink!';
      avatar.emoteTimer = 1500;
      io.emit('avatarAction', { id: key, action: 'wave', username: avatar.username });
      setTimeout(() => {
        if (avatar.state === 'waving') avatar.state = 'idle';
      }, 1500);
      console.log(`[Action] ${username} winkt`);
      break;

    // --- !sit ---
    case '!sit':
    case '!setzen':
      avatar.state = 'sitting';
      io.emit('avatarAction', { id: key, action: 'sit', username: avatar.username });
      setTimeout(() => {
        if (avatar.state === 'sitting') avatar.state = 'idle';
      }, 3000);
      console.log(`[Action] ${username} setzt sich`);
      break;

    // --- !flip ---
    case '!flip':
    case '!drehen':
      avatar.direction *= -1;
      io.emit('avatarAction', { id: key, action: 'flip', direction: avatar.direction, username: avatar.username });
      console.log(`[Action] ${username} dreht sich`);
      break;

    // --- !emote <text> ---
    case '!emote':
    case '!say':
      if (args.length > 0) {
        avatar.emote = args.join(' ').substring(0, 30);
        avatar.emoteTimer = 2500;
        io.emit('avatarAction', { id: key, action: 'emote', emote: avatar.emote, username: avatar.username });
        console.log(`[Action] ${username} Emote: ${avatar.emote}`);
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
      avatar.isJumping = false;
      avatar.color = AVATAR_COLORS[avatars.size % AVATAR_COLORS.length];
      avatar.emote = null;
      avatar.emoteTimer = 0;
      avatar.attackCooldown = 0;
      avatar.targetId = null;
      io.emit('avatarAction', { id: key, action: 'reset', avatar: avatar, username: avatar.username });
      console.log(`[Action] ${username} zurückgesetzt`);
      break;
  }
}

// ---------------------------------------------------------------------------
// Twitch Chat (tmi.js) — Anonymer Lese-Modus
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

  // Anonymer Login: justinfan + dummy oauth (kein Token noetig!)
  const anonUser = 'justinfan' + Math.floor(Math.random() * 99999);
  console.log(`[Twitch] Verbinde als ${anonUser} zu Kanälen: ${channels.join(', ')}`);

  twitchClient = new tmi.Client({
    options: { debug: false },
    connection: {
      reconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 15,
      secure: true
    },
    identity: {
      username: anonUser,
      password: 'oauth:1234567890'
    },
    channels: channels.map(c => c.startsWith('#') ? c : '#' + c)
  });

  twitchClient.on('message', (channel, tags, message, self) => {
    if (self) return;
    const username = tags['display-name'] || tags.username || 'Unknown';
    console.log(`[Twitch] ${username} in ${channel}: ${message}`);
    handleChatCommand(username, message, 'twitch');
  });

  twitchClient.on('connected', (addr, port) => {
    console.log(`[Twitch] Verbunden mit ${addr}:${port} — Kanäle: ${channels.join(', ')}`);
    connStatus.twitch = { connected: true, channel: channels.join(', '), error: null };
    broadcastStatus();
  });

  twitchClient.on('disconnected', (reason) => {
    console.log('[Twitch] Getrennt:', reason);
    connStatus.twitch = { connected: false, channel: channels.join(', '), error: reason || 'Getrennt' };
    broadcastStatus();
  });

  twitchClient.on('connecting', () => {
    console.log('[Twitch] Verbinde...');
  });

  twitchClient.on('reconnect', () => {
    console.log('[Twitch] Wiederverbindung...');
  });

  twitchClient.on('join', (channel, username, self) => {
    if (self) {
      console.log(`[Twitch] Kanal betreten: ${channel}`);
    }
  });

  twitchClient.connect().catch(err => {
    console.error('[Twitch] Verbindungsfehler:', err.message);
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
  res.json({ success: true, message: 'Nuke ausgeloest!' });
});

app.post('/api/remove-avatar', (req, res) => {
  removeAvatar(req.body.username);
  res.json({ success: true });
});

app.post('/api/clear-all', (_req, res) => {
  avatars.clear();
  battleRoyaleActive = false;
  battleRoyaleZone = null;
  io.emit('clearAll');
  res.json({ success: true });
});

app.post('/api/config', (req, res) => {
  const newConfig = req.body;
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

// Twitch connect/disconnect
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
  config.twitch.enabled = false;
  saveConfig();
  disconnectTwitch();
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
  console.log(`[Socket] Client verbunden: ${socket.id}`);

  // Sende init-Daten
  socket.emit('init', {
    avatars: Array.from(avatars.values()),
    battleRoyaleActive,
    battleRoyaleZone,
    connStatus,
    config
  });

  socket.emit('connStatus', connStatus);

  // Admin kann Befehle senden
  socket.on('chatCommand', (data) => {
    console.log(`[Admin] ${data.username}: ${data.command}`);
    handleChatCommand(data.username, data.command, data.platform || 'admin');
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client getrennt: ${socket.id}`);
  });
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('');
  console.log('  +======================================================+');
  console.log('  |       Avatar Stream System v0.0.3 (Twitch Only)      |');
  console.log('  +======================================================+');
  console.log(`  |  Overlay:  http://localhost:${PORT}/overlay              |`);
  console.log(`  |  Admin:    http://localhost:${PORT}/admin                |`);
  console.log('  +------------------------------------------------------+');
  console.log('  |  Chat-Befehle:                                       |');
  console.log('  |    !join  !jump  !dance  !attack  !color <farbe>     |');
  console.log('  |    !leave  !heal  !speed <1-5>  !grow  !shrink       |');
  console.log('  |    !wave  !sit  !flip  !emote <text>  !reset         |');
  console.log('  +======================================================+');
  console.log('');

  // Auto-connect falls Kanäle konfiguriert
  if (config.twitch.enabled && config.twitch.channels.length > 0) {
    const validChannels = config.twitch.channels.filter(c => c && c !== 'dein_twitch_kanal' && c.trim() !== '');
    if (validChannels.length > 0) {
      console.log('[Start] Verbinde Twitch automatisch...');
      connectTwitch();
    }
  }
});

process.on('SIGINT', () => {
  console.log('\n[Server] Fahre herunter...');
  disconnectTwitch();
  server.close();
  process.exit(0);
});
