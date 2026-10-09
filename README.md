<img src="assets/icon.svg" width="64" height="64" alt="">

# A Short Ski

A cosy little browser ski game inspired by *A Short Hike*. One Swiss mountain, three chairlifts, and a single question: how far can you ski before taking the lift back up?

```sh
bun install
bun run dev     # http://localhost:5173
bun run build   # static build in dist/
```

## Controls

| Key | Action |
| --- | --- |
| `A` / `D` (or arrows) | steer (in the air: spin) |
| `W` | tuck for speed, or skate when slow |
| `S` | brake / snowplough |
| `Space` | jump; hold it on a lift to ride faster |
| `E` | board a lift at its bottom station |
| `R` | back to the summit |
| `M` | mute |

Gamepads work too: left stick steers, A jumps, X/B boards the lift, and the triggers tuck/brake.

**Score:** distance skied since your last lift ride. Your best run is saved in `localStorage`.

## Code map

- `src/layout.ts`: hand-placed lifts, pistes, jumps, lake and village
- `src/terrain.ts`: heightmap mountain, high-res playable grid plus a coarse far landscape
- `src/player.ts`: ski physics (carving, friction, airtime, crashes, lifts)
- `src/skier.ts`: the clay skier model and its procedural animation
- `src/world.ts`: sky, lighting, forest, rocks, village, clouds, collisions
- `src/materials.ts`: procedural "thumb-pressed clay" normal maps and rim-lit clay material
- `src/hike-effect.ts`: low-resolution world rendering, warm colour grading, depth outlines and subtle ordered dithering; the HUD stays at full resolution
