<img src="assets/icon.svg" width="64" height="64" alt="">

# A Short Ski

A cosy little browser ski game inspired by *A Short Hike*. One open, snowy mountainside for working on the skiing mechanics. No marked pistes, trees, lifts, buildings, obstacles, or trail map.

```sh
bun install
bun run dev     # http://localhost:5173/?silent
bun run build   # static build in dist/
```

## Controls

Choose one of five friends with **1–5**, left/right arrows, or their name tags. Press **Enter** or **Let’s ski** to start. Gamepads can choose with the D-pad or shoulder buttons and start with A or Start.

| Key | Action |
| --- | --- |
| `A` / `D` (or arrows) | steer; spin in the air |
| `W` | tuck for speed, or skate when slow |
| `S` | brake / snowplough |
| `Space` | jump |
| `R` | restart at the top |
| `Esc` / `P` | pause |
| Mouse drag | look around; release to return to the follow camera |
| `M` | mute |

Gamepads: left stick steers, A jumps, triggers tuck/brake, Y resets, Start pauses.

Always use `?silent` when testing or taking screenshots. Automated browsers (`navigator.webdriver`) are also silent.

Distance is counted during each run. The best distance is saved when finishing or resetting.

## Corviglia snowfield

The descent starts at a local elevation of 680 m (~2,486 m above sea level), and ends on a flat snowy shoulder at 340 m (~2,146 m above sea level). The valley is distant scenery and cannot be reached on skis. Press R for another run. The 1.4 km wide practice area uses one snow surface and a steady downhill grade with seeded, irregular rolls, shallow dips, and a gently crowned hill shape. The patterns repeat between runs so changes to the ski mechanics can be compared on the same terrain.

The surrounding mountains and valley now come from **swisstopo’s real 3D terrain**, viewed from Corviglia (46.508484° N, 9.819294° E) toward bearing 145°. The 40 × 40 km background is sampled at 80 m spacing from 39 zoom-11 quantized-mesh tiles, revision 20250101. Geographic positions and relative heights are preserved in a local metre-based projection, without vertical exaggeration. Snow shading is artistic; buildings, vegetation and map imagery are omitted.

The playable hillside has procedural snow rolls on top of a steady downhill grade, blending into the surveyed landscape outside the practice area. Its start and halfway runout stay flat. This is not a surveyed ski route. The terrain’s vertical origin is shifted to keep the existing local physics coordinates; published absolute elevations are approximate, and fine summit detail is reduced by resampling.

The 502 KB heightfield is bundled with the game. Gameplay makes no requests to an external map service and needs no API key.

**Terrain ©swisstopo.** Sources and reuse terms:
- [Official 3D terrain service](https://docs.geo.admin.ch/visualize-data/terrain-service.html)
- [swissALTI3D elevation model](https://www.swisstopo.admin.ch/en/height-model-swissalti3d)
- [Swisstopo open-data terms](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices)
- [Corviglia viewpoint coordinates](https://www.outdooractive.com/en/route/winter-hiking/engadin-st.-moritz/corviglia-marguns/42605153/)

To regenerate the terrain with Python 3 (standard library only):

```sh
python3 scripts/import-engadine.py
```

The importer caches downloads in the system temporary directory, decodes the source triangles, and resamples their elevations. It refuses incomplete coverage. `src/data/engadine.json` records the projection, grid, source URLs, revision and SHA-256 checksums. `src/data/engadine.bin` stores little-endian unsigned 16-bit heights in decimetres; that storage precision does not imply decimetre geographic accuracy.

## Code map

- `src/layout.ts`: start, skiable limits, and halfway stopping point
- `src/terrain.ts`: continuous snowfield, matching collision heights, and blending into the real landscape
- `src/engadine.ts`, `src/data/`: bundled terrain loading and geographic elevation sampling
- `src/world.ts`: clear sky and lighting
- `src/player.ts`: carving, braking, jumps, landings, and run completion
- `src/skier.ts`, `src/characters.ts`, `src/animals.ts`: the five clay skiers
- `src/lineup.ts`: character selection and the transition onto skis

## Verification

`bun run build` checks TypeScript and builds for production. In the dev browser, verify downhill continuity, snow surfaces, braking, turning, jumping/landing, the halfway endpoint, boundaries, resets, source integrity, and geographic terrain:

```js
(await import('/scripts/verify-mountain.mjs')).verifyMountain(game)
```
