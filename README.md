# Motocross Bobness

A browser remake of Motocross Madness (1998). See [RESEARCH.md](RESEARCH.md) for reference material and the plan.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build into dist/
npm run render:engine  # write engine-sound previews to audio-preview/*.wav
npm run sim        # headless physics checks (standing still, cruising, turning, weight shift, full run)
```

Controls: **W** throttle, **S** brake, **A/D** steer, **↑/↓** lean forward/back, **←/→** lean sideways,
**Q/E** shift (switches to manual), **M** auto/manual, **C** camera (chase/far/helmet/thrill), **R** reset (or skip a wipeout), **N** mute. Gamepad supported.

Stunts (in the air): hold **Space** or **Shift** and pick the trick with the arrows (pad: A/X + right stick).
Space: Superman, ↑ Cliffhanger, ↓ Heel Clicker, ←/→ Nac Nac. Shift: Double Can Can, ↑ Bar Hop, ↓ Splits,
←/→ Saran Wrap. Hold a trick fully out to score; tuck back in before landing or it's a wipeout. Air time and
flips add bonus points. Ride off the edge of the map and the out-of-bounds cannon fires you back across it.

Crashes: land on your head, nose-dive, loop out, land flat from very high or get thrown off and the rider goes ragdoll; you respawn where you crashed once they stop tumbling.

Stack: TypeScript, Vite, Three.js, Rapier (WASM physics).

Models: the bike and rider are free CC-BY models from Sketchfab (see [CREDITS.md](CREDITS.md)), in `assets/models/`. The bike file has 7 colours (red, orange, yellow, green, blue, white, black); pick one in `src/main.ts`. `node scripts/inspect-glb.ts <file.glb>` prints a model's parts and skeleton.
