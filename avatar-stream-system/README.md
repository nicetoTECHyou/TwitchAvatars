# Avatar Stream System

**Lokales OBS-Overlay mit Twitch-Chat-Integration, Sprite-Animationen und Battle Royale Modus.**

---

## Schnellstart

```bash
# Windows: Doppelklick auf install.bat, dann start.bat

# Oder manuell:
npm install
npm start

# Browser oeffnen:
# Overlay:  http://localhost:3000/overlay
# Admin:    http://localhost:3000/admin
```

---

## OBS-Einrichtung

1. OBS oeffnen → **Quellen** → **Hinzufuegen** → **Browser**
2. URL: `http://localhost:3000/overlay`
3. Breite: `1920` / Hoehe: `1080`
4. **Wichtig:** Haken bei "Browser neu starten, wenn die Szene aktiv wird" setzen
5. Hintergrund ist transparent – Avatare schweben ueber deinem Stream!

**Tipp:** Debug-Modus mit `http://localhost:3000/overlay?debug=1` zeigt Zustandsinfo oben links.

---

## Twitch-Integration

1. Admin-Panel oeffnen: `http://localhost:3000/admin`
2. Twitch-Kanalnamen eintragen (ohne #)
3. Auf "Verbinden" klicken
4. Fertig! Chat-Befehle werden automatisch erkannt.

**Hinweis:** tmi.js verbindet sich als anonymer Leser – kein OAuth-Token noetig!

---

## Chat-Befehle

| Befehl | Wirkung |
|--------|---------|
| `!join` | Erstellt einen Avatar auf dem Overlay |
| `!jump` | Avatar springt |
| `!dance` | Avatar tanzt (3 Sekunden) |
| `!attack` | Avatar greift an (nur im Battle Royale) |
| `!color <farbe>` | Avatar-Farbe aendern (z.B. !color red, !color #FF6B6B) |
| `!heal` | +20 HP heilen |
| `!speed <1-5>` | Tempo einstellen |
| `!grow` | Avatar wachsen |
| `!shrink` | Avatar schrumpfen |
| `!wave` | Avatar winkt |
| `!sit` | Avatar setzt sich (3 Sekunden) |
| `!flip` | Avatar dreht sich um |
| `!emote <text>` | Sprachblase anzeigen |
| `!leave` | Avatar verlassen |
| `!reset` | Avatar zuruecksetzen |

---

## Admin-Interface (`localhost:3000/admin`)

- **Twitch-Verbindung:** Kanal eintragen, verbinden/trennen
- **Test-Avatar spawnen:** Sofort einen Avatar zum Testen erstellen
- **5 Avatare spawnen:** Mehrere Avatare auf einmal
- **Battle Royale:** Alle Avatare kaempfen gegeneinander (KI-gesteuert)
- **Nuke:** Alle Avatare sofort zerstoeren (mit Explosionseffekt)
- **Chat-Simulator:** Befehle manuell testen
- **Einstellungen:** Avatar-Groesse, Schaden live anpassen

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

Ein Sprite-Sheet besteht aus einem 4x4-Raster (4 Spalten, 4 Zeilen):

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

**Beispiel:** Bei 64px pro Frame → Gesamtbild = 256x256 px

### Eigene Sprites hinzufuegen

1. Sprite-Sheet als `.png` in `public/sprites/avatars/` ablegen
2. Entsprechende `.json`-Datei mit Metadaten erstellen
3. Sprites werden vom Overlay automatisch erkannt

---

## Battle Royale Modus

1. Mindestens 2 Avatare auf dem Bildschirm
2. Im Admin-Interface auf "Battle Royale" klicken
3. Jeder Avatar bekommt 100 HP
4. KI steuert die Avatare – sie jagen den naechsten Gegner
5. Die rote Zone schrumpft langsam zusammen
6. Letzter Ueberlebender gewinnt!
7. Chat-Kommando `!attack` laesst Zuschauer aktiv angreifen

---

## Performance-Optimierungen

- **requestAnimationFrame** statt setInterval → Sync mit Monitor-Refresh
- **DPR = 1** im Canvas → Kein HiDPI-Overhead in OBS
- **Delta-Time Capping** → Keine Spruenge bei Tab-Switch
- **Alpha-Transparenz** → Canvas-Hintergrund transparent fuer OBS
- **Event-basierte Kommunikation** → Kein Polling, nur bei Aenderungen
- **Lokale Physik** → Overlay berechnet Bewegung selbst, kein Server-Flaschenhals

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
└──────────────┘                    └─────────────────┘
```

---

## Konfiguration (`config.json`)

| Einstellung | Standard | Beschreibung |
|-------------|----------|--------------|
| `twitch.enabled` | `false` | Twitch-Chat automatisch verbinden |
| `twitch.channels` | `[]` | Twitch-Kanaele (ohne #) |
| `avatar.size` | `64` | Avatar-Groesse in Pixeln |
| `avatar.jumpHeight` | `120` | Sprunghoehe in Pixeln |
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
| API State | `GET http://localhost:3000/api/state` |
| Spawn Test | `POST http://localhost:3000/api/spawn-test` |
