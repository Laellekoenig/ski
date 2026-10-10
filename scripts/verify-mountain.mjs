// Run in the dev browser: (await import('/scripts/verify-mountain.mjs')).verifyMountain(game)
// Exercise the real heightfield and fixed-step ski physics.
export async function verifyMountain(game) {
  const { baseHeight } = await import('/src/terrain.ts');
  const { ENGADINE, geographicHeight, sampleElevation } = await import('/src/engadine.ts');
  const { BOUNDS, RUN_END } = await import('/src/layout.ts');
  const { player, world, debug } = game;
  const t = world.terrain;
  const results = [];
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    results.push(name);
  };
  const input = { ...game.input.state, steer: 0, tuck: true, brake: false, jumpPressed: false, actionPressed: false };
  const events = player.events;
  const paused = debug.pauseSimulation;
  debug.pauseSimulation = true;
  player.events = {};
  const step = (seconds, keys = {}) => {
    for (let i = 0; i < seconds * 120; i++) player.update(1 / 120, { ...input, ...keys, jumpPressed: i === 0 && !!keys.jumpPressed, swingPressed: i === 0 ? keys.swingPressed ?? 0 : 0 });
  };
  try {
    const response = await fetch('/src/data/engadine.bin');
    const binary = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', binary))].map(v => v.toString(16).padStart(2, '0')).join('');
    check('Bundled terrain matches its source manifest', response.ok && digest === ENGADINE.sha256 && binary.byteLength === ENGADINE.grid.nx * ENGADINE.grid.nz * 2);
    check('Corviglia source elevation is plausible', sampleElevation(0, 0) > 2400 && sampleElevation(0, 0) < 2550);
    check('The Bernina massif rises above 3900 m at its geographic position', sampleElevation(-2488, 15422) > 3900);
    check('The lake basin lies below Corviglia at its geographic position', sampleElevation(376, 2636) > 1700 && sampleElevation(376, 2636) < 1850);
    for (const [x, z] of [[-2488, 15422], [-6513, 8954], [376, 2636], [8000, -8000]]) {
      check('Distant elevations use map data without invented peaks', Math.abs(baseHeight(x, z) - geographicHeight(x, z)) < 0.001);
    }
    for (const x of [-696, 0, 696]) {
      let previous = t.heightAt(x, 0);
      for (let z = 0; z <= BOUNDS.maxZ; z += 8) {
        const h = t.heightAt(x, z);
        check(`Snowfield descends at ${x}, ${z}`, h <= previous + 0.001 && t.surfaceAt(x, z) === 'snow');
        check(`Heightfield matches its deterministic mesh at ${x}, ${z}`, Math.abs(h - baseHeight(x, z)) < 0.01);
        previous = h;
      }
    }
    let minGrade = Infinity, maxGrade = -Infinity, reliefRange = 0;
    for (let x = -696; x <= 696; x += 16) {
      for (let z = 160; z <= 1000; z += 8) {
        const grade = (t.heightAt(x, z) - t.heightAt(x, z + 8)) / 8;
        minGrade = Math.min(minGrade, grade);
        maxGrade = Math.max(maxGrade, grade);
        reliefRange = Math.max(reliefRange, Math.abs(t.heightAt(x, z) - t.heightAt(x + 80, z)));
      }
    }
    check('Rolling terrain keeps a steady downhill grade without uphill traps', minGrade > 0.06 && maxGrade < 0.52);
    check('The hill has substantial height variation across the snow', reliefRange > 5);
    check('The lower limit stays halfway above the valley', Math.abs(t.heightAt(0, RUN_END) / t.heightAt(0, 0) - 0.5) < 0.01);
    player.spawnAtSummit();
    step(12);
    check('Pushing off reaches the continuous descent', player.pos.z > 60 && player.speed > 10);
    const speed = player.speed;
    step(3, { tuck: false, brake: true });
    check('Braking slows the skier', player.speed < speed * 0.5);
    const swingRun = (swingPressed) => {
      player.spawnAt(0, 250, 0);
      step(5, { tuck: false });
      const before = player.speed;
      step(0.5, { tuck: false, swingPressed });
      return { before, after: player.speed };
    };
    const glide = swingRun(0);
    const swung = swingRun(1);
    check('A double-tap swing sheds speed without stopping', swung.after < glide.after - 2 && swung.after > swung.before * 0.5);
    player.spawnAt(0, 250, 0);
    step(4);
    step(0.25, { jumpPressed: true });
    check('Jump leaves the snow', !player.grounded && player.pos.y > t.heightAt(player.pos.x, player.pos.z) + 0.5);
    step(2);
    check('Jump lands safely', player.grounded && player.state === 'ski');
    player.spawnAt(0, 250, 0);
    step(8);
    const jumpFrom = player.pos.clone();
    step(0.01, { jumpPressed: true });
    while (!player.grounded) step(0.01);
    check('Jumps at speed stay short', Math.hypot(player.pos.x - jumpFrom.x, player.pos.z - jumpFrom.z) < 20);
    player.spawnAt(0, 600, Math.PI);
    const climbFrom = player.pos.y;
    let climbed = 0;
    for (let i = 0; i < 20 * 120; i++) {
      step(1 / 120);
      climbed = Math.max(climbed, player.pos.y - climbFrom);
    }
    check('Skating cannot climb the slope', climbed < 1);
    player.spawnAtSummit();
    let topSpeed = 0;
    for (let i = 0; i < 60 * 30; i++) {
      step(1 / 30, { steer: Math.sin(i / 30 * 2.2) > 0 ? 1 : -1 });
      topSpeed = Math.max(topSpeed, player.speed);
    }
    check('Turning back and forth cannot pump up speed', topSpeed < 25);
    // the same rhythm switching edges in the carve meter's sweet spot, untimed vs. timed, ducked for the most speed
    // (a short gap between the keys, as on a keyboard: the meter runs on until the other edge is pressed)
    const carveRun = (hold) => {
      player.spawnAt(0, 250, 0);
      step(5, { tuck: true });
      let sum = 0, top = 0, carves = 0, side = 1;
      player.events = { onCarve: () => carves++ };
      for (let turn = 0; turn < 40; turn++, side = -side) {
        for (let i = 0; i < hold * 120; i++) {
          step(1 / 120, { duck: true, steer: side });
          sum += player.speed;
          top = Math.max(top, player.speed);
        }
        step(0.1, { duck: true });
      }
      player.events = {};
      return { avg: sum / (40 * hold * 120), top, carves };
    };
    const untimed = carveRun(0.3);
    const timed = carveRun(0.5);
    check('Timed carves gain speed but stay under the top speed', timed.carves > 30 && untimed.carves === 0 && timed.avg > untimed.avg + 2 && timed.top < 27);
    // letting go in the sweet spot without switching edges earns nothing, and costs nothing
    const releaseRun = (steer) => {
      player.spawnAt(0, 250, 0);
      step(5, { tuck: true });
      let carves = 0, washes = 0;
      player.events = { onCarve: () => carves++, onWashOut: () => washes++ };
      step(0.6, { duck: true, steer: 1 });
      const before = player.speed;
      step(0.5, { duck: true, steer });
      player.events = {};
      return { carves, washes, gain: player.speed - before };
    };
    const letGo = releaseRun(0);
    const heldOn = releaseRun(1);
    check('Letting go in the sweet spot neither boosts nor scrubs', letGo.carves === 0 && letGo.washes === 0 && heldOn.washes === 1 && letGo.gain > heldOn.gain + 1);
    player.spawnAt(0, 250, 0);
    step(3);
    step(0.7, { steer: 0.6 });
    check('Steering changes heading and carves across the snow', player.heading < -0.3 && player.pos.x < -1);
    let finishes = 0;
    player.events = { onFinish: () => finishes++ };
    player.spawnAtSummit();
    step(140);
    check('A full descent ends on the shoulder', player.finished && player.pos.z >= RUN_END && player.pos.z <= BOUNDS.maxZ && player.pos.y >= 339);
    const end = player.pos.clone();
    step(10, { jumpPressed: true });
    check('The valley cannot be entered after finishing', player.pos.equals(end) && player.speed === 0 && finishes === 1);
    for (const [x, z, heading] of [[699, 300, Math.PI / 2], [-699, 300, -Math.PI / 2], [0, -34, Math.PI]]) {
      player.spawnAt(x, z, heading);
      step(5);
      check('Side and uphill limits keep skiing within the snowfield', player.pos.x >= BOUNDS.minX && player.pos.x <= BOUNDS.maxX && player.pos.z >= BOUNDS.minZ);
    }
    player.spawnAtSummit();
    check('Reset clears the finish and returns to the start', !player.finished && player.pos.x === 0 && player.pos.z === 0 && player.pos.y === 680 && player.speed === 0);
    return { passed: results.length, hill: { minGrade, maxGrade, reliefRange }, mechanics: results.slice(-13) };
  } finally {
    player.events = events;
    player.spawnAtSummit();
    player.runDistance = 0;
    debug.pauseSimulation = paused;
    game.snapCamera();
  }
}
