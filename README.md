# Motocross Bobness

A browser remake of Motocross Madness (1998). See [RESEARCH.md](RESEARCH.md) for reference material and the plan.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build into dist/
npm run sim        # headless physics checks (standing still, cruising, turning, weight shift, full run)
```

Controls: **W** throttle, **S** brake, **A/D** steer, **↑/↓** lean forward/back, **←/→** lean sideways,
**Q/E** shift (switches to manual), **M** auto/manual, **C** camera, **R** reset. Gamepad supported.

Stack: TypeScript, Vite, Three.js, Rapier (WASM physics).
