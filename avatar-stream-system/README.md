# Avatar Stream System

**Lokales OBS-Overlay mit Twitch/Kick-Chat-Integration, Sprite-Animationen und Battle Royale Modus.**

---

## Schnellstart

```bash
# 1. Abhängigkeiten installieren
npm install

# 2. Server starten
npm start

# 3. Browser öffnen
# Overlay:  http://localhost:3000/overlay
# Admin:    http://localhost:3000/admin
```

---

## OBS-Einrichtung

1. OBS öffnen → **Quellen** → **Hinzufügen** → **Browser**
2. URL: `http://localhost:3000/overlay`
3. Breite: `1920` / Höhe: `1080`
4. **Wichtig:** Haken bei "Browser neu starten, wenn die Szene aktiv wird" setzen
5. Hintergrund ist transparent – Avatare schweben über deinem Stream!

---

## Twitch-Integration

1. Öffne `config.json`
2. Trage deinen Twitch-Kanal ein: `"channels": ["dein_kanal_name"]`
3. Setze `"enabled": true`
4. Server neu starten

**Hinweis:** tmi.js verbindet sich als anonymer Leser – kein OAuth-Token nötig!

---

## Chat-Befehle

| Befehl | Wirkung |
|--------|---------|
| `!join` | Erstellt einen Avatar auf dem Overlay |
| `!jump` | Avatar springt |
| `!attack` | Avatar greift an (nur im Battle Royale) |
| `!dance` | Avatar tanzt |

---

## Admin-Interface (`localhost:3000/admin`)

- **Test-Avatar spawnen:** Sofort einen Avatar zum Testen erstellen
- **5 Avatare spawnen:** Mehrere Avatare auf einmal
- **Battle Royale:** Alle Avatare kämpfen gegeneinander (KI-gesteuert)
- **Nuke:** Alle Avatare sofort zerstören (mit Explosionseffekt)
- **Kick-Simulator:** Kick-Chat-Nachrichten simulieren
- **Einstellungen:** Avatar-Größe, Schaden, Twitch-Kanal live anpassen

---

## Sprite-Ordner-Struktur

```
public/sprites/
├── avatars/
│   ├── default.png      ← Standard-Avatar (4x4 Grid)
│   ├── default.json     ← Animations-Metadaten
│   ├── warrior.png      ← Optionaler Krieger-Sprite
│   └── warrior.json
└── effects/
    ├── explosion.png    ← Explosionseffekt
    └── explosion.json
```

### Sprite-Format: 4x4 Grid

Ein Sprite-Sheet besteht aus einem **4×4-Raster** (4 Spalten, 4 Zeilen):

```
┌─────┬─────┬─────┬─────┐
│ 0,0 │ 1,0 │ 2,0 │ 3,0 │  ← Zeile 0: Idle-Animation
├─────┼─────┼─────┼─────┤
│ 0,1 │ 1,1 │ 2,1 │ 3,1 │  ← Zeile 1: Laufen
├─────┼─────┼─────┼─────┤
│ 0,2 │ 1,2 │ 2,2 │ 3,2 │  ← Zeile 2: Springen
├─────┼─────┼─────┼─────┤
│ 0,3 │ 1,3 │ 2,3 │ 3,3 │  ← Zeile 3: Angreifen / Tot
└─────┴─────┴─────┴─────┘
```

**Beispiel:** Bei 64px pro Frame → Gesamtbild = **256×256 px**

### JSON-Datei pro Sprite

```json
{
  "name": "default",
  "columns": 4,
  "rows": 4,
  "frameWidth": 64,
  "frameHeight": 64,
  "animations": {
    "idle":      { "row": 0, "frames": [0, 1, 2, 3], "speed": 150 },
    "walking":   { "row": 1, "frames": [0, 1, 2, 3], "speed": 120 },
    "jumping":   { "row": 2, "frames": [0, 1, 2, 3], "speed": 100 },
    "attacking": { "row": 3, "frames": [0, 1, 2, 3], "speed": 80  },
    "dancing":   { "row": 0, "frames": [0, 1, 2, 3], "speed": 100 },
    "dead":      { "row": 3, "frames": [3], "speed": 0 }
  }
}
```

### Eigene Sprites hinzufügen

1. Sprite-Sheet als `.png` in `public/sprites/avatars/` ablegen
2. Entsprechende `.json`-Datei mit Metadaten erstellen
3. Server startet automatisch neu (oder manuell `npm start`)
4. Sprites werden vom Overlay automatisch erkannt

---

## Battle Royale Modus

1. Mindestens 2 Avatare auf dem Bildschirm
2. Im Admin-Interface auf **"Battle Royale"** klicken
3. Jeder Avatar bekommt 100 HP
4. KI steuert die Avatare – sie jagen den nächsten Gegner
5. Die rote Zone schrumpft langsam zusammen
6. Letzter Überlebender gewinnt!
7. Chat-Kommando `!attack` lässt Zuschauer aktiv angreifen

---

## Performance-Optimierungen

- **requestAnimationFrame** statt setInterval → Sync mit Monitor-Refresh
- **DPR = 1** im Canvas → Kein HiDPI-Overhead in OBS
- **Delta-Time Capping** → Keine Sprünge bei Tab-Switch
- **State-Interpolation** → Smooth movement zwischen Server-Updates
- **Alpha-Transparenz** → Canvas-Hintergrund transparent für OBS
- **Throttled Broadcasts** → Max 60 State-Updates/Sekunde

---

## Architektur

```
┌──────────────┐     Socket.io      ┌─────────────────┐
│   OBS Overlay │ ◄───────────────► │    Server.js     │
│  (Canvas+RAF) │                    │  (Express+IO)    │
└──────────────┘                    │                  │
                                    │  ┌─────────────┐ │
┌──────────────┐     HTTP API       │  │   tmi.js    │ │
│  Admin-Panel  │ ◄───────────────► │  │  (Twitch)   │ │
│  (localhost)  │                    │  └─────────────┘ │
└──────────────┘                    │                  │
                                    │  ┌─────────────┐ │
                                    │  │ Kick-Sim    │ │
                                    │  │  (API)      │ │
                                    │  └─────────────┘ │
                                    └─────────────────┘
```

---

## Konfiguration (`config.json`)

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| `twitch.enabled` | `true` | Twitch-Chat aktivieren |
| `twitch.channels` | `[]` | Twitch-Kanäle (ohne #) |
| `avatar.size` | `64` | Avatar-Größe in Pixeln |
| `avatar.jumpHeight` | `120` | Sprunghöhe in Pixeln |
| `avatar.defaultSpeed` | `2` | Bewegungsgeschwindigkeit |
| `battleRoyale.damagePerHit` | `10` | Schaden pro Treffer |
| `battleRoyale.attackRange` | `60` | Angriffsreichweite |
| `battleRoyale.attackCooldown` | `800` | Abklingzeit zwischen Angriffen (ms) |

---

## Ports & URLs

| Dienst | URL |
|--------|-----|
| Overlay | `http://localhost:3000/overlay` |
| Admin | `http://localhost:3000/admin` |
| API State | `http://localhost:3000/api/state` |
| Kick Sim | `POST http://localhost:3000/api/kick-sim` |
| Spawn Test | `POST http://localhost:3000/api/spawn-test` |
