// Run in the dev browser: (await import('/scripts/verify-mountain.mjs')).verifyMountain(game)
// Exercises the actual terrain and fixed-step player, without a second renderer.
export async function verifyMountain(game) {
  const { Terrain } = await import('/src/terrain.ts');
  const { PISTES, KICKERS, LAKES, BOUNDS } = await import('/src/layout.ts');
  const { stormAt } = await import('/src/weather.ts');
  const { player, world, debug } = game;
  const terrain = world.terrain;
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
  try {
    const copy = new Terrain();
    check('A new terrain has identical heights and routes', terrain.heights.every((h, i) => h === copy.heights[i]) && terrain.pisteDist.every((d, i) => d === copy.pisteDist[i]));
    for (const mesh of [copy.mesh, copy.farMesh]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    check('Playable area is over five times larger', (BOUNDS.maxX - BOUNDS.minX) * (BOUNDS.maxZ - BOUNDS.minZ) > 5 * 900 * 1380);
    for (let face = 0; face < 8; face++) {
      player.spawnAtSummit();
      player.heading = Math.PI - face * Math.PI / 4;
      for (let i = 0; i < 1200; i++) player.update(1 / 120, input);
      check(`${PISTES[face].name} is reachable downhill from the center`, Math.hypot(player.pos.x, player.pos.z) > 100 && player.pos.y < 600);
    }
    for (const trail of PISTES.filter(p => p.connector)) {
      const a = trail.points[0], b = trail.points.at(-1);
      check(`${trail.name} joins two real descents and loses altitude`, [a, b].every(p => PISTES.slice(0, 8).some(t => t.points.some(q => Math.hypot(p.x - q.x, p.z - q.z) < 0.01))) && terrain.heightAt(a.x, a.z) > terrain.heightAt(b.x, b.z));
    }
    for (const lake of LAKES) check(`${lake.name} is skiable ice`, terrain.surfaceAt(lake.x, lake.z) === 'ice');
    check('Powder exists away from the groomed trails', terrain.surfaceAt(-550, 350) === 'powder');
    check('Storm stays on the glacier face', stormAt(500, -650) > 0.99 && stormAt(-500, 650) === 0 && stormAt(0, 0) === 0);
    const jumps = [];
    for (const jump of KICKERS) {
      player.spawnAtSummit();
      const dx = Math.sin(jump.heading), dz = Math.cos(jump.heading);
      player.pos.set(jump.x - dx * (jump.length + 10), 0, jump.z - dz * (jump.length + 10));
      player.pos.y = terrain.heightAt(player.pos.x, player.pos.z);
      player.heading = jump.heading;
      player.vel.set(dx * 23, 0, dz * 23);
      const normal = terrain.normalAt(player.pos.x, player.pos.z);
      player.vel.addScaledVector(normal, -player.vel.dot(normal)).normalize().multiplyScalar(23);
      let air = 0, clearance = 0;
      for (let i = 0; i < 600; i++) {
        player.update(1 / 120, input);
        air = Math.max(air, player.airTime);
        clearance = Math.max(clearance, player.pos.y - terrain.heightAt(player.pos.x, player.pos.z));
      }
      check(`${jump.name} produces real airtime`, air > 0.3 && clearance > 0.8 && Number.isFinite(player.pos.y));
      jumps.push({ name: jump.name, airSeconds: +air.toFixed(2), clearance: +clearance.toFixed(1) });
    }
    for (const lift of world.lifts) {
      player.spawnAtSummit();
      player.pos.copy(lift.bottom);
      player.update(1 / 120, { ...input, actionPressed: true });
      check(`${lift.def.name} can be boarded`, player.state === 'lift');
      player.rideS = lift.rideLength;
      player.update(1 / 120, input);
      check(`${lift.def.name} returns to a safe top exit`, player.state === 'ski' && player.grounded && Number.isFinite(player.pos.y));
    }
    player.spawnAtSummit();
    check('Reset returns to the exact central summit', player.pos.x === 0 && player.pos.z === 0 && player.pos.y === 640 && player.speed === 0);
    return { passed: results.length, results, jumps };
  } finally {
    player.events = events;
    player.spawnAtSummit();
    player.runDistance = 0;
    debug.pauseSimulation = paused;
    game.snapCamera();
  }
}
