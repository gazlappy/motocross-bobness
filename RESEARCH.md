# Motocross Bobness — research notes

Goal: a browser remake that plays as close to **Motocross Madness (1998, Rainbow Studios / Microsoft)** as possible.

> **Legal ground rule.** Every original asset (models, textures, tracks, sounds, music, logos, the name)
> belongs to Microsoft. Use the originals **as reference only** — to study and match. What ships in the
> game is our own work or properly licensed free assets. Don't call the game "Motocross Madness".

---

## 1. What the original actually was

### Core features (from Microsoft's 1998 product page, archived)
- **Separate rider and bike physics** — the selling point. You control throttle, brake, steering, **gears**,
  and the **rider's centre of gravity** (forward / back / left / right). That weight shift is what made it feel right.
- **16 controllable mid-air stunts.**
- Built for 3D hardware acceleration (Direct3D, DirectX 5); **motion-captured riders**.
- **Track editor** for supercross tracks, built from templates that shipped with the game.
- Multiplayer: 8 players on LAN, 4 over the internet (MSN Gaming Zone). Every race and stunt event worked in MP, plus a **Tag** mode on a Baja course.
- Min spec: Pentium 133, 16 MB RAM, a 2–4 MB 3D card. Any modern browser can do far better.

### Event types
| Mode | What it is |
|---|---|
| **Supercross** | Indoor stadiums, tight turns, lots of small jumps (rhythm sections) |
| **Nationals** | Outdoor loops with steep banks and big jumps |
| **Baja** | Open wilderness, no set track — ride from waypoint to waypoint using a GPS/arrow |
| **Enduro** | Long outdoor courses (track names not found yet) |
| **Stunt Quarry** | Hilly arenas built for big air; score points for stunts in a time limit |
| **Tag** (MP) | Tag game on a Baja map |
| **Career** | Seasons of harder and harder races; winnings unlock bikes and rider skins |

### Track names (from a fan wiki — not checked against the game files)
- **Nationals:** Airborne Delivery, Augusta Park, Beta's Bluegrass, Claymore Hills, Custer's Last Stand, Desert Heat,
  Dirt Devil, Flatlands, Gold Rush, Paradise Lost, Pittfall, Pressure Cooker, Sky Lane, Terminal Velocity
- **Baja:** Arizona Waypoint, Bowling Greens Waypoint, Painted Desert Waypoint, Rocky Road Waypoint (#1/#2),
  T-rific Waypoint (#1/#2), Yuma Dunes Waypoint (#1/#2)
- **Stunt Quarry:** Arizona Exploration, Bowling Greens, Painted Desert, Rocky Road, T-rific, Widowmaker
- **Supercross / Enduro:** names still needed
- Terrain mood: desert, sand dunes, rolling bluegrass hills, red-rock quarries.

### The stunts (official list from the Microsoft site, each had a demo clip)
Bar Hop · Barney · Skurfer · Big Kahuna Dumpster · Double Can Can · Fender Bender · Stale Fish Saran Wrap ·
Cuffed · Heel Clicker · Nac Nac · Saran Wrap · Cliffhanger · Splits · Split-X · Superman · Tailstand · Twist

Scoring: each stunt is a preset button combo, and **holding it longer scores more**. Bad landings = crash.
The button mapping for each stunt hasn't turned up yet — the original manual didn't explain it either; the official site had a separate stunt guide.

### Feel and quirks worth copying
- Cameras: **first-person, third-person chase, and "Thrill Cam"** (a cinematic camera that picks the most exciting angle).
- **Bikes:** 125cc, 250cc two-strokes and four-strokes, each with an accurate engine sound. Engine and shocks could be tuned.
- Riding up a big cliff and going off the edge of the map fires the famous **"invisible slingshot" / cannon** that launches you across the map with a silly sound effect. Must have.
- Hidden key boosts uphill and gets you back on the bike quickly after a crash.
- Cheats: `bigheads` (big-head mode), a secret bike code. Easy easter eggs to add.
- Ragdoll crashes ("bone-chilling" wrecks) were a big part of the fun; reviewers did find the crash *sounds* weak.
- Music: a generic hard-rock track (composer Mark Stratford). Little or no music during races.
- Feel: easy to learn, hard to master; braking, lines, and weight shift matter. Real whips were possible.

---

## 2. Reference material from the original (study only — don't ship)

**Microsoft's official 1998 site, saved by the Wayback Machine** — the best single source:
- Features: https://web.archive.org/web/19991012095502/http://microsoft.com/games/motocross/features.htm
- Downloads page (stunt clips + audio): https://web.archive.org/web/19990210183352/http://microsoft.com/games/motocross/downloads.htm
- **17 stunt demo clips** (AVI, 60–340 KB each), e.g.
  https://web.archive.org/web/2000/http://www.microsoft.com/games/motocross/video/stunts/superman.avi
  (swap the filename: `barhop`, `barney`, `skurfer`, `bigkahunadumpster`, `doublecancan`, `fenderbender`,
  `fishwrap`, `cuffed`, `heelclicker`, `nacnac`, `saranwrap`, `cliffhanger`, `splits`, `splitx`, `superman`, `tailstand`, `twist`).
  These show each rider pose exactly — use them as the animation reference.
- **~150 screenshots**: `.../games/motocross/art/screenshots/dmp000NN.jpg` and `.../art/screenshots2/dmp00001–dmp00129.jpg` (HUD, menus, terrain colours, track editor `trkedit2.jpg`).
- **Engine/crowd audio**: `.../games/motocross/audio/bike.wav` (RPM sweep), `idle.wav`, `clap_03.wav` (crowd), `max04.wav`, `oh_01.wav`. Good targets to match our engine sound to.
- Full URL list: https://web.archive.org/web/*/microsoft.com/games/motocross/*
- System specs and hardware: https://web.archive.org/web/19990501175532/http://microsoft.com/games/motocross/technical.htm

**Track data** (only if you own the game):
- File formats (MIT, 010 Editor templates for `.DAT`, `.TRN` terrain, `.VUB` animations): https://github.com/AlexKimov/motocross-madness-file-formats
- Extract MCM1 tracks to `.obj` + heightmap (Python script + Blender): https://www.moddb.com/tutorials/how-to-extract-and-convert-levels-from-motocross-madness-1
- How Rainbow built the outdoor tracks (TGA heightmaps, `MakeTerr.exe`, `.SCN` sun/fog settings): https://www.moddb.com/games/motocross-madness/tutorials/creating-motocross-madness-outdoor-tracks
- Fan tracks: https://www.moddb.com/games/motocross-madness/addons
- Extracted heightmaps are good for getting each track's *shape* right; then rebuild it with our own textures. Don't put the extracted files online.

**Reviews with detail:**
- GamesFirst 1998: https://gamesfirst.com/articles/1998/motocross-madness/
- Cycle World 1999 (stunt names, cameras): https://magazine.cycleworld.com/article/1999/6/1/microsoft-motocross-madness
- Wikipedia: https://en.wikipedia.org/wiki/Motocross_Madness_(1998_video_game)
- Cheats and quirks: https://www.cheatbook.de/files/motom.htm
- YouTube gameplay / soundtrack (search "Motocross Madness 1998 gameplay") for how it moves and the camera.

---

## 3. Free assets we *can* ship

Check each item's licence before importing; note CC-BY credits in a `CREDITS.md`.

### Bike and rider models (Sketchfab, downloadable, CC-BY = credit required)
Low-poly fits the 1998 look and runs fast in a browser:
- Dirt Bike — 3k tris: https://sketchfab.com/3d-models/792295f9b1c347a09d776edab55f997e
- LowPoly-Bike — 4k tris: https://sketchfab.com/3d-models/7f3eb6e79a124115a2b2b4cb2ae87bc1
- DIRT BIKE OFF ROAD LOW POLY — 17k: https://sketchfab.com/3d-models/dbcca404b21348c69938207d265b6035
- Mid poly dirt bike — 19k: https://sketchfab.com/3d-models/3009c80ec6cc47fcaad27cf96f2a0822
- Yz250 — 22k: https://sketchfab.com/3d-models/127c9d767260468f821da3cba9d7db7e
- Motocross Helmet — 6k: https://sketchfab.com/3d-models/b8487c414e6641eda2bb4c952d3772f7
- Low-Poly Dirt Park Modular Kit (jumps/ramps; *Free Standard* licence): https://sketchfab.com/3d-models/7a030085e4664f5cb2c14fdc91e77775
- ⚠ Skip models that look ripped from commercial games (e.g. "HCR2 Motocross", 1M-tri branded bikes) — their CC tags often aren't legit.

**Rider:** No good free rigged motocross rider turned up. Options:
1. A CC0 rigged human from **Quaternius** (quaternius.com) or **Kenney** (kenney.nl), then add a helmet and jersey colours.
2. **Mixamo** (free with an Adobe account, OK to use in games) for the rig and base animations.
3. Stunt poses can be built as keyframed IK targets that copy the archived stunt clips. Crashes switch to a ragdoll.

### Terrain textures and sky (CC0, no credit needed)
- **Poly Haven** (polyhaven.com/textures): `aerial_sand`, `coast_sand_01..05`, `dense_sand`, `dirt`, `dirt_aerial_02/03`,
  `brown_mud`, `brown_mud_dry`, `dry_ground_01`, `dry_mud_field_001`, `cracked_red_ground`, `cliff_side`,
  `excavated_soil_wall`, `farm_soil`, `grass_path_2/3`, `aerial_grass_rock`, `forest_ground_04..06`, `gravel_ground_01`
- **Poly Haven HDRIs** for skies (pick clear-desert and overcast ones).
- **ambientCG** (ambientcg.com) — more CC0 ground and rock textures.
- To match 1998, use low-res textures (256–512px) with simple fog, not full PBR.

### Sound (Freesound — free account needed to download; filter set to CC0)
- Motocross bike starting and ticking over: https://freesound.org/people/kristian321/sounds/175964/
- Motocross dirt bike SFX: https://freesound.org/people/paulcola/sounds/363253/
- Dirt bike pass-by: https://freesound.org/people/kyles/sounds/450039/
- CRM 250 onboard pull-away: https://freesound.org/people/martian/sounds/148868/
- Suzuki DRZ forest passes: https://freesound.org/people/Flares.fr/sounds/671044/
- Motocrossers (group): https://freesound.org/people/unfa/sounds/168077/
- Crowd cheers (supercross): https://freesound.org/people/FoolBoyMedia/sounds/397434/ and /397435/
- Big arena crowd: https://freesound.org/people/kyles/sounds/629884/
- Body fall on dirt (crashes): https://freesound.org/people/leonelmail/sounds/504626/ , Stupid Falls: https://freesound.org/people/qubodup/sounds/50941/
- Tyre on dirt / gravel roll loops: https://freesound.org/people/SpliceSound/sounds/218301/ , https://freesound.org/people/Q.K./sounds/56305/
- Freesound licences are set per sound, so check each one when downloading even with the CC0 filter on.

**Engine sound approach:** loop 3–5 RPM bands (idle / low / mid / high / max) and crossfade + pitch-shift them from
the RPM value in Web Audio. Or make the sound in code with an AudioWorklet — reference: https://github.com/SpudzzDev/en
Paid fallback if free recordings sound weak: Sonniss *TM 125 2018* pack (2-stroke 125cc at steady RPMs).

---

## 4. Browser tech stack (recommendation)

| Piece | Choice | Why |
|---|---|---|
| Language/build | **TypeScript + Vite** | Fast dev server, simple static build, deploys anywhere |
| Rendering | **Three.js** | Mature, huge ecosystem, glTF loader, easy heightmap terrain |
| Physics | **Rapier** (`@dimforge/rapier3d-compat`, WASM) | Fast, deterministic, has joints for the rider/ragdoll and raycasts for wheels |
| Audio | Web Audio API (maybe Howler for the menu sounds) | Needs real-time pitch/crossfade for the engine |
| Input | Keyboard + **Gamepad API** | The original was made for a stick — gamepad analog lean matters |
| Multiplayer (later) | WebRTC (PeerJS) or a small WebSocket server | Tag + racing, 4–8 players |

### Physics model (how to get the original's feel)
- **Bike** = rigid body (chassis) + 2 wheels done with **raycast suspension** (spring/damper per wheel, separate front and rear travel),
  tyre grip that changes per surface (sand vs hardpack), and an engine curve + gearbox.
- **Rider** = second body joined to the bike with springy joints. Lean input moves the rider's weight forward, back and sideways,
  which pitches and rolls the bike in the air and changes the grip on the ground. This is the core of the game.
- In the air: rider lean pitches/rotates the bike, stunt input blends into the stunt pose, holding it adds points.
- **Crash** when the landing angle or impact is too big, or the rider's head hits something → rider drops into a full ragdoll, then respawns.
- Terrain = heightfield (Rapier has `heightfield` colliders), 2–4 m grid, 1–2 km maps for Baja.

### Build order
1. Heightmap terrain + one bike that drives (raycast wheels, throttle/brake/steer/gears).
2. Rider weight-shift + air control; chase camera, first-person, Thrill Cam.
3. Engine audio from RPM.
4. Crashes + ragdoll + respawn.
5. Stunts (start with Nac Nac, Superman, Heel Clicker) + scoring HUD.
6. One Nationals track with gates/laps + AI riders following a racing line.
7. Supercross stadium, Baja waypoints, Stunt Quarry + slingshot easter egg.
8. Career mode, bike unlocks, track editor, multiplayer.

---

## 5. From the original disc (studied 2026-10-19)

The user's own retail CD image was unpacked into `reference/` (git-ignored, as is the image) and
read with the scripts in `tools/mcm-reference/`. Nothing from it ships; these are facts and
measurements for matching the feel. Units in the game files are **feet** (the standing rider's
pelvis sits 4.3 units above the ground, the head about 5.5).

### What's on the disc
| Files | What they are | Decoded? |
|---|---|---|
| `TERAFORM/*/*.SCN`, `WAYPOINT/*.RSC` | Plain-text scene setup: track name, terrain file, sky cube, sun, fog colour, crowd | Yes (text) |
| `TERAFORM/*/*.DAT` | Track centreline: u32 count, then x, (unused), z, height (f32) and a point type (0/2/3) | Yes |
| `TERAFORM/WAYPOINT/*.WPT` | Baja waypoints, plain text (`PointNX/Z`, look-at points) | Yes (text) |
| `TERAFORM/*/*.TRN` | Terrain: palette, 64×64 tile map, 858 tiles of 16×16 heights + texture indices, 16 terrain textures 256×256 | Layout yes; the height tiles use a custom compression (not LZSS or LZW), so **heights and wall shapes are not decoded** |
| `TERAFORM/*/*.TGA` | Menu preview picture of each track | Yes |
| `SBIKE/*.VUB`, `RIDER.VUT`, `RIDER.MCF` | Motion-captured rider/bike animations: per frame, per bone two axis vectors + a position; the .MCF lists each motion's fps and length | Yes |
| `MCM.EXE` | Stunt and event names | Strings only |
| `LANG/USA/HELP/CONTENTS/*.HTM` | The game's manual: controls, stunts, events, garage, riding tips | Yes (text) |

### Tracks vs ours
Original Nationals tracks (from the .DAT centrelines):

| Track | Lap | Fits in | Control-point height range |
|---|---|---|---|
| Flatlands (easy) | 685 m | 194×136 m | 2 m |
| Sky Lane | 822 m | 194×151 m | 6 m |
| Gold Rush | 901 m | 188×180 m | 53 m |
| Pitfall | 1020 m | 188×201 m | 0 m |
| Bela's Bluegrass | 1019 m | 196×175 m | 4 m |
| Custer's Last Stand | 1095 m | 179×165 m | 0 m |
| Terminal Velocity | 1149 m | 190×197 m | 9 m |
| Desert Heat | 1162 m | 186×199 m | 34 m |
| Augusta Park | 1175 m | 201×197 m | 14 m |
| Claymore Hills | 1286 m | 196×203 m | 47 m |
| Airborne Delivery | 1344 m | 193×192 m | 68 m |
| Paradise Lost | 1387 m | 205×202 m | 4 m |
| Dirt Devil | 1416 m | 187×194 m | 22 m |
| Pressure Cooker | 1420 m | 199×194 m | 30 m |
| **Ours (Nationals)** | **939 m** | **154×384 m** | **10 m** |

- Every original track is packed into a ~200 m square in the middle of a big map, folding back on
  itself with 40-75 degree bends every 10-20 m. Ours is stretched out (384 m long) and gentler.
- Laps run 0.7-1.4 km; ours is at the short end.
- Several tracks climb and drop 30-70 m over a lap (hillside tracks); ours varies 10 m. Point types
  look like 2 = curve, 3 = straight, 0 = feature (jumps cluster there); not confirmed.
- The menu previews show deep ruts, tall berms and rough hills right up to the track.

### Walls and the off-track rule
- Wall heights couldn't be read (compressed terrain). The previews show steep bowl sides.
- Nationals: leave the track and you have **5 seconds** to rejoin where you left it, or you're put
  back at the point you exited; a **green arrow** points the way. Supercross shows a yellow arrow
  to the re-entry point. (Ours: 5 s, reset to the nearest safe point on the track, no arrow.)
- Moto-Tag: tag-backs allowed after **5 seconds** (ours: 10 s). Tag was multiplayer-only.

### Stunts
16 stunts plus two extras, with the stunt keys as modifiers on the lean keys, like ours. Each key
holds eight, one per lean direction going round (the manual's table repeats fwd+right and fwd+left,
which look like misprints for back+right and back+left):
- **Stunt key 1** + lean: Heel Clicker (fwd), Barney (fwd+right), Nac-Nac (right), Fender Bender
  (back+right?), Superman (back), Stale Fish Saran-Wrap (back+left?), Split "X" (left), Cuffed (fwd+left).
- **Stunt key 2** + lean: Bar Hop (fwd), Saran-Wrap (fwd+right), Twist (right), Splits (back+right?),
  Skurfer (back), Tail Stand (back+left?), Double Can-Can (left), Cliff Hanger (fwd+left).
- **Big Kahuna Dumpster** (its own key): a Skurfer, then the rider jumps off the bike, meant as a
  victory jump after the finish. **Taunt** (point as you pass) has its own key too.
- Animation lengths (how much air each needs): 1.0 s (Split "X") to 2.25 s (Big Kahuna); most
  1.3-2.0 s. Quarry scoring rewards harder stunts and holding a stunt longer in the air.
- Ours has 8 (Superman, Cliffhanger, Heel Clicker, Nac Nac, Double Can Can, Bar Hop, Splits,
  Saran Wrap), each with a mirrored left version.

### Bikes and garage
- One bike, a 250 "thumper", tuned in a **garage**: three engine power curves (A: strong low end,
  late peak; B: strong midrange that revs out fast; C: soft bottom, long top-end peak), front and
  rear suspension from soft to stiff, and a tyre traction slider (less grip for hard pack, more
  for soft ground). Our 125/250/250F/450 line-up is our own.

### Handling (from the manual's riding tips)
- In the air the brake drops the nose and the throttle drops the rear (ours does the same).
- Gas with your weight back, or uphill, and you wheelie, loop it, or slide off the back.
- Uphill: weight forward and centred. Downhill: weight back. After take-off on doubles: weight forward.
- Uneven landings: weight slightly forward, then back. Level landings: centred.

### Open maps and boundaries
- Every outdoor map (Nationals, Baja, Stunt Quarry) uses the same big terrain format; Baja and
  Stunt Quarry even share terrains (`Baja00.trn` is the Quarry00 ground). Supercross/Season arenas
  are a smaller format (257 tiles vs ~870).
- Baja waypoints (12 routes, `.WPT`) sit between ~240 m and ~1400 m on both axes: the open maps are
  roughly **1.5 km across**, and routes keep **~240 m clear of the map edge** (where the bowl walls
  are). Routes run **2.3-7.3 km** with **8-18 waypoints**, legs **30-890 m** apart. Ours: one
  ~2.3 km route, 8 waypoints, on a 1.1 km arena.
- Each quarry terrain also has a hidden closed path (`QUARRY*.DAT`, 1.4-2.9 km; `DUNES.DAT` 6 km)
  wound through a **~250-350 m** central area: the quarry pit sits in the middle of the big open
  map, with open country between it and the walls. Our Stunt Quarry is a 350 m arena on its own.
- `RANDOM*.RSC` files set up a random-waypoint Baja mode (the game picks the route).
- Wall heights and shapes: still in the compressed terrain tiles.

### The original bike's physics settings (`SBIKE/BIKE2.BIK`, plain text)
| Setting | Original | Ours (250 two-stroke) |
|---|---|---|
| Physics rate | 50 Hz, up to 10 steps per frame | 120 Hz |
| Weight | bike 109 kg + rider 75 kg | bike 105 kg + rider 75 kg |
| Engine | 3 curves (the garage's A/B/C): a dev 250, "CR 250", "KX 250"; peak 43-46 hp at 7,250-7,500 rpm, 10,000 rpm redline, 3,000 rpm floor | 38 Nm at 8,500 rpm ≈ 45 hp, 11,500 redline |
| Gears | 5; auto-shifts at road speeds of 15, 28, 41, 52, 65 mph; 0.05 s per shift; indoor gearing ~17% shorter | 5; shifts on road-speed rpm, 0.25 s |
| Top speed | capped at 109 mph (drag is tiny) | 85 mph (drag-limited) |
| Lean | max 40°, 120°/s | ~47°, 143°/s |
| Steering lock | 36° | 35.5° |
| Cornering | sideways (static) friction 6.0, sliding 0.15: the bike turns on its bars, lean is mostly for show | classic: sideways grip 1.9 (Easy 1.6) on top of the lean, ~1.35 g turns; realistic: lean-limited, ~0.65 g |
| Suspension | front 0.30 m travel, 14.6 kN/m + cubic; rear 0.21 m, 8.8 kN/m + cubic; garage sliders ±10-20% | 0.42 m both, 6.2 kN/m + progressive bump stop |
| Brakes | 778 N total (≈ 0.43 g) | 1,700 N front + 850 N rear |
| Traction | slider 0.85-1.0 (default 0.95); full grip only above 13.7 m/s | μ 1.15 (classic) / 0.95 (realistic) |
| Crash limits | lean 70°, pitch 85°, 6 g acceleration / 25 g deceleration | landing-based: 16 m/s impact, nose-down 46°, roll 60° |
| Wheelies | animation at 0.24 m / 0.55 m front-wheel lift | — |

## 6. Still to find
- Terrain heights (the .TRN tile compression), which would give the walls and hills exactly.
- Supercross track layouts (the track editor's `.TRK`/`.TER` files are uncompressed and look decodable).
