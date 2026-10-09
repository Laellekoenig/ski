<img src="assets/icon.svg" width="64" height="64" alt="">

# A Short Ski

A cosy little browser ski game inspired by *A Short Hike*. One permanent Swiss mountain, eight faces, and a web of trails to make your own way down.

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
| `Tab` | open / close the trail map (pauses skiing) |
| `Esc` | close the trail map if open; otherwise toggle the pause menu |
| `P` | toggle the pause menu |
| Mouse drag | look around; release to return to the follow camera |
| `M` | mute |

Gamepads work too: left stick steers, A jumps, X/B boards the lift, and the triggers tuck/brake.

**Score:** distance skied since your last lift ride. Your best run is saved in `localStorage`.

## Code map

- `src/layout.ts`: the fixed Vierwind layout: routes, connections, lifts, landscapes, jumps and lakes
- `src/terrain.ts`: heightmap mountain, high-res playable grid plus a coarse far landscape
- `src/player.ts`: ski physics (carving, friction, airtime, crashes, lifts)
- `src/skier.ts`: the clay skier model and its procedural animation
- `src/characters.ts`, `src/animals.ts`: the five mountain friends, outfits, and sculpted animal features
- `src/character-select.ts`: live 3D character selection on the start screen
- `src/world.ts`: sky, lighting, forest, rocks, village, clouds, collisions
- `src/weather.ts`: the permanent glacier storm, drifting snow and visibility transitions
- `src/materials.ts`: procedural "thumb-pressed clay" normal maps and rim-lit clay material

## Vierwind mountain

The 2.64 × 2.64 km map is identical every game. Start at the 640 m summit in the center, turn toward any of eight faces, and press W to push off. The 28 trails include sixteen downhill traverses that join neighboring faces at different elevations. Eight lifts return to the upper mountain; R returns directly to the summit, including during a lift ride.

- **Granite wilds (northwest):** exposed rock ribs, narrow chutes, boulders and optional gap jumps.
- **Whiteout glacier (northeast):** a persistent snowstorm with gradual visibility changes and a frozen tarn.
- **Powder gardens (southwest):** pine glades and deep snow with greater drag and powder spray.
- **Mirror lakes (southeast):** two frozen lakes, shoreline routes and slippery ice.

Orange flags mark fifteen sculpted jump features: rollers, tabletops, gaps with landing banks, and angled hip transfers. Use the trail map to find them and plan connections. Blue/red/black trails indicate increasing difficulty; teal lines connect runs.

## Mountain verification

Run `bun run build` for type checking and the production build. With the dev game loaded, run this in its browser console to check terrain repeatability, all eight departures, all sixteen connections, surface types, jumps, lift boarding/dismounts and summit resets:

```js
(await import('/scripts/verify-mountain.mjs')).verifyMountain(game)
```
