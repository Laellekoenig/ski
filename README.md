<img src="assets/icon.svg" width="64" height="64" alt="">

# A Short Ski

A cosy little browser ski game inspired by *A Short Hike*. One open, snowy mountainside for working on the skiing mechanics. No marked pistes, trees, lifts, buildings, obstacles, or trail map.

```sh
bun install
bun run dev     # http://localhost:5173/?silent
bun run build   # static build in dist/
```

The riders look like PS2-era characters: smooth, rounded bodies, painted faces and loud turn-of-the-millennium outfits. Beni wears a flame jacket, a knit beanie with a wild shock of red fake hair and shades on the back of his head; Mila a bubblegum puffer, fluffy earmuffs and white sunglasses; Rex a Memphis-print one-piece, a mullet under a neon sweatband and gold aviators; Kenji a lightning-bolt speed suit with a race bib, a full-face helmet and a gold mirror visor; Zoe a holographic puffer, space buns with butterfly clips and tiny tinted glasses; Dex a tie-dye hoodie, a bucket hat over his locs and round shades; Pip a shark onesie whose toothy hood frames her freckled face. Beni, Rex, Kenji and Dex are male; Mila, Zoe and Pip are female. Each has a distinct silhouette, colour and equipment setup.

## Controls

Choose one of seven human riders with **1–7**, left/right arrows, or their name tags. Press **Enter** to start. Gamepads can choose with the D-pad or shoulder buttons and start with A or Start.

| Key | Action |
| --- | --- |
| `A` / `D` (or arrows) | steer; spin in the air |
| `Q` / `E` | gentle, wider curve; slower spin in the air |
| double-tap `A` / `D` | swing: pivot the skis across to scrub off some speed in a cloud of snow |
| `W` | tuck for speed, or skate when slow |
| `Shift` (hold) | duck into a low racing tuck: faster, but steering is cut to about a third |
| `S` | brake / snowplough |
| `Space` | jump |
| `Space`, then hold `A` / `D` for about half the flight | spin a 180 and land switch, riding backwards; spin another 180 to face forward again. Under- or over-rotate and you fall |
| `R` | restart at the top |
| `Esc` / `P` | pause |
| Mouse drag | look around; release to return to the follow camera |
| `M` | mute |

Gamepads: left stick steers, A jumps, triggers tuck/brake, right bumper ducks, Y resets, Start pauses.

Always use `?silent` when testing or taking screenshots. Automated browsers (`navigator.webdriver`) are also silent.

Distance is counted during each run. The best distance is saved when finishing or resetting.

## Corviglia snowfield

The descent starts at a local elevation of 680 m (~2,486 m above sea level), and ends on a flat snowy shoulder at 340 m (~2,146 m above sea level). The valley is distant scenery and cannot be reached on skis. Press R for another run. The 1.4 km wide practice area uses one snow surface and a steady downhill grade with seeded, irregular rolls, shallow dips, and a gently crowned hill shape. The patterns repeat between runs so changes to the ski mechanics can be compared on the same terrain.

The surrounding mountains and valley now come from **swisstopo’s real 3D terrain**, viewed from Corviglia (46.508484° N, 9.819294° E) toward bearing 145°. The 40 × 40 km background is sampled at 80 m spacing from 39 zoom-11 quantized-mesh tiles, revision 20250101. Geographic positions and relative heights are preserved in a local metre-based projection, without vertical exaggeration. Artistic winter shading exposes dark rock on steep upper faces and wind-scoured crests, leaving snow in gullies and gentle basins. Buildings, vegetation and map imagery are omitted.

The rock and snow treatment draws on winter photographs from [Grialetsch](https://www.imageo.ch/Europa/Schweiz/Graubuenden/Grialetsch20070317_Grialetsch_d_10.html) and the [Mont Blanc massif](https://skitour.fr/sorties/177932). It is procedural, with no photo textures or changes to the surveyed geometry or skiable snow.

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
- `src/mountain-material.ts`: procedural exposed rock and broken snow edges on the distant mountains
- `src/engadine.ts`, `src/data/`: bundled terrain loading and geographic elevation sampling
- `src/world.ts`: winter sky with thin drifting clouds, atmospheric haze, and lighting
- `src/weather.ts`: sparse, subtle diamond dust (the snow reflections live in `src/materials.ts`)
- `src/player.ts`: carving, ducking, braking, swings, jumps, landings, switch riding, and run completion
- `src/skier.ts`, `src/characters.ts`, `src/gear.ts`, `src/equipment.ts`: four articulated skiers with smooth lathed and lofted bodies, shaped skis and bindings
- `src/looks.ts`: printed outfits, painted faces, hair and headwear
- `src/lineup.ts`: character selection and the transition onto skis

## Verification

`bun run build` checks TypeScript and builds for production. In the dev browser, verify downhill continuity, snow surfaces, braking, turning, jumping/landing, the halfway endpoint, boundaries, resets, source integrity, and geographic terrain:

```js
(await import('/scripts/verify-mountain.mjs')).verifyMountain(game)
```
