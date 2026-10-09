export type V2 = { x: number; z: number };
export interface LiftDef { name: string; color: number; bottom: V2; top: V2 }

export const MAP_NAME = "Corviglia";
// Local elevation is relative to the valley (~1,806 m). Skiing stops halfway down.
export const VALLEY_ALTITUDE = 1806;
export const BOUNDS = { minX: -700, maxX: 700, minZ: -35, maxZ: 1320 };
export const SUMMIT = { x: 0, z: 0 };
export const RUN_END = 1290;
