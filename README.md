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
npm run race -- nationals 250f  # args: laps, venue, bike (125, 250, 250f)
npm run jump-speeds [supercross] [125]  # which approach speeds land each jump cleanly (tunes the AI)
npm run bikes      # drag race and roll-on times for each bike
npm run sim        # headless checks (physics, crashes, stunts, career rules, a full race)
```

Controls (defaults): **W** throttle, **S** brake, **A/D** steer, **↑/↓** lean forward/back, **←/→** lean sideways,
**Q/E** shift (switches to manual), **M** auto/manual, **C** camera (chase/far/helmet/thrill), **R** reset (or skip a wipeout), **N** mute.
Gamepad: RT/LT gas and brake, left stick steer, right stick lean, A/X stunts, Y reset, B camera, Start for the menu.
**Options > Controls**: choose **Easy** (the rider shifts their own weight: levels the bike for landings, keeps the front
down pulling away, automatic gears; lean by hand any time to take over) or **Advanced** (the original's full manual weight
shift), and remap every key (main and alternate) and every gamepad stick, trigger and button (with invert). Saved in the browser.

The game opens on a main menu over a live attract-mode race: **Career**, **Single Event** (Nationals, Supercross,
Baja, Stunt Quarry or Free Ride, with laps, opponents, rival difficulty, session time, venue, bike and colour), **Options** (volume, units,
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

Bikes: a 125cc two-stroke (light, peaky, needs revs), the 250cc two-stroke (hard-hitting) and a 250cc
four-stroke (torque everywhere, lower top speed). Each has its own engine sound; four-strokes thump.

Career: three series (Rookie on 125s, Pro and Champions Cup on 250s), each a six-event season against
the same six rivals: Nationals, Supercross, Baja, a cash-only Stunt Quarry bonus, Supercross Main and the
Nationals Final. Places score points (25-20-16-...) and prize money; the championship pays a bonus, and a top-three
finish unlocks the next series. Spend winnings in the garage. Saved in the browser.

Multiplayer (up to 8): **Multiplayer > Host a game** gives a 5-letter room code; friends pick **Join** and type it.
The host chooses Nationals or Supercross races, Baja, **Tag** (Baja or Quarry: whoever is "it" racks up time until they
ride into someone; least time wins) or Free Ride, and can fill race grids with AI riders. Browsers connect directly over
WebRTC (PeerJS); the free public PeerJS server only introduces them. Each player's machine simulates their own bike and
sends its state 20 times a second; everyone else's bikes are drawn smoothly a moment behind and are solid while moving.
Each rider's own machine decides their finish, so everyone sees the same results. The game keeps running behind the menu.
Some strict networks (corporate, some mobile) block direct connections; there's no relay server yet.

Stunts (in the air): hold **Space** or **Shift** and pick the trick with the arrows (pad: A/X + right stick).
Space: Superman, ↑ Cliffhanger, ↓ Heel Clicker, ←/→ Nac Nac. Shift: Double Can Can, ↑ Bar Hop, ↓ Splits,
←/→ Saran Wrap. Hold a trick fully out to score; tuck back in before landing or it's a wipeout. Air time and
flips add bonus points. Ride off the edge of the map and the out-of-bounds cannon fires you back across it.

Crashes: land on your head, nose-dive, loop out, land flat from very high or get thrown off and the rider goes ragdoll; you respawn where you crashed once they stop tumbling.

Stack: TypeScript, Vite, Three.js, Rapier (WASM physics).

Models: free CC-BY models from Sketchfab (see [CREDITS.md](CREDITS.md)), in `assets/models/`. The bike is the rigged Honda CRF 450 (steering, fork, swingarm and wheels driven by the physics; its red plastics are hue-shifted for the other six colours); **Options > Bike model** switches back to the original low-detail bike, which has 7 colour variants built in. `node scripts/inspect-glb.ts <file.glb>` prints a model's parts and skeleton.
