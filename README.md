# Motocross Bobness

A browser remake of Motocross Madness (1998). See [RESEARCH.md](RESEARCH.md) for reference material and the plan.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build into dist/
npm run render:engine  # write engine-sound previews to audio-preview/*.wav
npm run race       # headless 3-lap Nationals between seven AI riders (lap times, crashes)
npm run race:sx    # the same, 2 laps of Supercross
npm run race:baja  # the same, a Baja waypoint race
npm run jump-speeds [supercross]  # which approach speeds land each jump cleanly (tunes the AI)
npm run sim        # headless physics checks (standing still, cruising, turning, weight shift, full run)
```

Controls: **W** throttle, **S** brake, **A/D** steer, **↑/↓** lean forward/back, **←/→** lean sideways,
**Q/E** shift (switches to manual), **M** auto/manual, **C** camera (chase/far/helmet/thrill), **R** reset (or skip a wipeout), **N** mute. Gamepad supported.

The game opens on a main menu over a live attract-mode race: **Select Game** (Nationals, Supercross,
Baja, Stunt Quarry or Free Ride, with laps, opponents, rival difficulty, session time, venue and your bike colour), **Options** (volume, units,
gearbox, camera, shadows, resolution, controls help; saved in the browser) and **Credits**.
**Esc** (pad Start) pauses: resume, restart, options or quit to the menu.

The race: a 3-lap Nationals on a ~940 m loop (berms, rollers, tabletops, a step-up double and
whoops) against six AI riders on the other bike colours. 3-2-1-GO from the grid, ordered
checkpoints (no shortcuts), live position and lap timer, results at the finish (race again or back to the menu).
Crashes put you back on the track with a run-up to the next jump.

The other venues:
- **Supercross**: a tight ~520 m serpentine on a dirt floor inside a night-time stadium, with a rhythm
  section, whoops, tabletops and Tuff Block lane markers. Padded walls, a crowd that cheers your big air, no cannon.
- **Baja**: 1.28 km of open desert with dunes, mesas and washes. Race the field through 8 numbered
  waypoints (tall beacons; the next one glows and an arrow over your bike points to it) and pick your own line.
- **Stunt Quarry**: a sunken quarry full of kickers, mounds and a volcano. Score as many stunt points as
  you can in 1, 2 or 3 minutes; your best for each length is saved in the browser.
- **Free Ride**: any of the four venues to yourself.

Stunts (in the air): hold **Space** or **Shift** and pick the trick with the arrows (pad: A/X + right stick).
Space: Superman, ↑ Cliffhanger, ↓ Heel Clicker, ←/→ Nac Nac. Shift: Double Can Can, ↑ Bar Hop, ↓ Splits,
←/→ Saran Wrap. Hold a trick fully out to score; tuck back in before landing or it's a wipeout. Air time and
flips add bonus points. Ride off the edge of the map and the out-of-bounds cannon fires you back across it.

Crashes: land on your head, nose-dive, loop out, land flat from very high or get thrown off and the rider goes ragdoll; you respawn where you crashed once they stop tumbling.

Stack: TypeScript, Vite, Three.js, Rapier (WASM physics).

Models: the bike and rider are free CC-BY models from Sketchfab (see [CREDITS.md](CREDITS.md)), in `assets/models/`. The bike file has 7 colours (red, orange, yellow, green, blue, white, black); pick yours in the game setup menu. `node scripts/inspect-glb.ts <file.glb>` prints a model's parts and skeleton.
