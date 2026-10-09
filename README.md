<img src="assets/icon.svg" width="64" height="64" alt="">

# A Short Ski

A cosy little browser ski game inspired by *A Short Hike*. One Swiss mountain, three chairlifts, and a single question: how far can you ski before taking the lift back up?

```sh
bun install
bun run dev     # http://localhost:5173
bun run build   # static build in dist/
```

## Controls

Pick your skier on the start screen with **1–5** (number row or numpad), the left/right arrows, or a click. Press **Enter**, **Space**, or the **Let’s ski** button to start. Gamepads can choose with the D-pad or shoulder buttons and start with A or Start.

Meet Beni the Alpine ibex, Mila the Alpine marmot, Lumi the mountain hare, Fynn the red fox, and Nico the chamois. Each has a handmade clay model and colourful ski outfit; all share the same ski physics. Your chosen friend stays with you through jumps, crashes, chairlift rides, and summit resets.

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
- `src/characters.ts`, `src/animals.ts`: the five mountain friends, outfits, and sculpted animal features
- `src/character-select.ts`: live 3D character selection on the start screen
- `src/world.ts`: sky, lighting, forest, rocks, village, clouds, collisions
- `src/materials.ts`: procedural "thumb-pressed clay" normal maps and rim-lit clay material
