// A single, permanent mountain. The summit is the origin; every compass face descends.
export type V2 = { x: number; z: number };
export interface LiftDef { name: string; color: number; bottom: V2; top: V2 }
export interface PisteDef {
  name: string;
  color: number;
  width: number;
  points: V2[];
  connector?: boolean;
}
export type Landscape = "summit" | "rock" | "storm" | "powder" | "lakes";
export const MAP_NAME = "Vierwind";
export const BOUNDS = { minX: -1320, maxX: 1320, minZ: -1320, maxZ: 1320 };
export const SUMMIT = { x: 0, z: 0 };
const v = (x: number, z: number): V2 => ({ x, z });
/** Compass bearing: 0 = north, 90 = east. */
export const polar = (r: number, degrees: number): V2 => v(Math.sin(degrees * Math.PI / 180) * r, -Math.cos(degrees * Math.PI / 180) * r);

export const REGIONS = {
  summit: { name: "Vierwind summit", detail: "Choose any direction · W to push off", color: "#edb859" },
  rock: { name: "Granite wilds", detail: "Rock chutes · cliff drops · expert terrain", color: "#ab9489" },
  storm: { name: "Whiteout glacier", detail: "Snowstorm · low visibility · follow the poles", color: "#93b6dc" },
  powder: { name: "Powder gardens", detail: "Deep snow · pine glades · soft landings", color: "#80af9b" },
  lakes: { name: "Mirror lakes", detail: "Frozen lakes · slippery ice · shoreline jumps", color: "#75cbd7" },
} as const;

export function landscapeAt(x: number, z: number): Landscape {
  if (Math.hypot(x, z) < 210) return "summit";
  if (z < 0) return x < -70 ? "rock" : "storm";
  return x < 0 ? "powder" : "lakes";
}

// Eight faces, with shared junctions at 300, 560, 820 and 1160 metres from the peak.
const names = ["Northwind", "Glacier run", "Sunrise ridge", "Mirror run", "Home run", "Powder ribbon", "Pine hollow", "Granite chute"];
const colors = [0xd94c50, 0xd94c50, 0x337bd5, 0x337bd5, 0x337bd5, 0x337bd5, 0xd94c50, 0x353546];
export const PISTES: PisteDef[] = names.map((name, i) => ({
  name, color: colors[i], width: i === 7 ? 28 : 40,
  points: [polar(24, i * 45), polar(140, i * 45 + (i % 2 ? 5 : -5)), polar(300, i * 45),
    polar(430, i * 45 + (i % 2 ? -6 : 6)), polar(560, i * 45),
    polar(690, i * 45 + (i % 2 ? 5 : -5)), polar(820, i * 45), polar(1160, i * 45)],
}));

// Descending diagonal traverses form a woven network, rather than dead-end spokes.
for (let i = 0; i < 8; i++) {
  const a = i * 45;
  PISTES.push({ name: `${names[i]} traverse`, color: 0x409c9a, width: 30, connector: true,
    points: [polar(300, a), polar(365, a + 15), polar(450, a + 30), polar(560, a + 45)] });
  PISTES.push({ name: `${names[i]} link`, color: 0x409c9a, width: 30, connector: true,
    points: [polar(560, a), polar(630, a - 15), polar(720, a - 30), polar(820, a - 45)] });
}
PISTES.push(
  { name: "Lake promenade", color: 0x337bd5, width: 36, points: [polar(820, 90), polar(900, 105), polar(1000, 115), polar(1100, 125), polar(1160, 135)] },
  { name: "Pillow line", color: 0xd94c50, width: 30, points: [polar(300, 225), v(-310, 325), v(-365, 470), v(-525, 570), polar(820, 225)] },
  { name: "Razorback", color: 0x353546, width: 26, points: [polar(300, 315), v(-375, -280), v(-520, -320), v(-640, -485), polar(820, 315)] },
  { name: "Icefall escape", color: 0xd94c50, width: 30, points: [polar(560, 45), v(415, -640), v(430, -820), v(545, -1000), polar(1160, 45)] },
);

export const LIFTS: LiftDef[] = [
  { name: "Homeward lift", color: 0xe8423f, bottom: v(10, 1165), top: v(34, 64) },
  { name: "Powder lift", color: 0x409c9a, bottom: v(-1165, -12), top: v(-65, 30) },
  { name: "Northwind lift", color: 0x788ecb, bottom: v(-12, -1165), top: v(-30, -65) },
  { name: "Sunrise lift", color: 0xf2a93b, bottom: v(1165, 12), top: v(65, -30) },
  { name: "Mirror lift", color: 0x55bac5, bottom: v(835, 827), top: v(270, 242) },
  { name: "Glade lift", color: 0x72a67a, bottom: v(-827, 835), top: v(-242, 270) },
  { name: "Granite lift", color: 0x916f87, bottom: v(-835, -827), top: v(-270, -242) },
  { name: "Glacier lift", color: 0x568ac2, bottom: v(827, -835), top: v(242, -270) },
];

export interface JumpDef extends V2 {
  name: string;
  heading: number;
  height: number;
  length: number;
  width: number;
  kind: "tabletop" | "gap" | "hip" | "roller";
}
const jumpOn = (piste: number, point: number, name: string, kind: JumpDef["kind"], height: number): JumpDef => {
  const p = PISTES[piste].points;
  return { ...p[point], name, kind, height, length: kind === "roller" ? 28 : 24, width: 10,
    heading: Math.atan2(p[point + 1].x - p[point - 1].x, p[point + 1].z - p[point - 1].z) };
};
export const KICKERS: JumpDef[] = [
  jumpOn(0, 3, "Wind lip", "hip", 6),
  jumpOn(1, 5, "Glacier gap", "gap", 7),
  jumpOn(2, 3, "Sunrise table", "tabletop", 5),
  jumpOn(2, 5, "Ridge roller", "roller", 4),
  jumpOn(3, 3, "Lake overlook", "tabletop", 6),
  jumpOn(4, 3, "Homeward hop", "roller", 3),
  jumpOn(4, 5, "Last light", "tabletop", 5),
  jumpOn(5, 3, "Powder pillow", "roller", 5),
  jumpOn(6, 5, "Forest gap", "gap", 6),
  jumpOn(7, 3, "Raven's leap", "gap", 8),
  jumpOn(12, 2, "East-west transfer", "hip", 6),
  jumpOn(18, 2, "Glade transfer", "hip", 5),
  jumpOn(25, 2, "Pillow pop", "roller", 5),
  jumpOn(26, 2, "Razor drop", "gap", 9),
  { x: 565, z: 530, name: "Lakeside launch", heading: Math.PI / 10, height: 5.5, length: 28, width: 13, kind: "hip" },
];

export const LAKES = [
  { name: "Mirror lake", x: 610, z: 610, radius: 102 },
  { name: "Blue tarn", x: 890, z: 375, radius: 65 },
  { name: "Glacier tarn", x: 530, z: -920, radius: 76 },
];

export const CHALETS = [
  { x: 85, z: 1180, rot: 0.2, size: 1 }, { x: 120, z: 1230, rot: -0.3, size: 1.2 },
  { x: -70, z: 1215, rot: 0.5, size: 0.9 }, { x: -110, z: 1160, rot: 0.1, size: 1.1 },
  { x: 180, z: 1190, rot: -0.6, size: 0.9 }, { x: -1160, z: 70, rot: 1.5, size: 1 },
  { x: 1110, z: -60, rot: -1.2, size: 1 }, { x: 870, z: 850, rot: -0.4, size: 1 },
  { x: -870, z: 800, rot: 0.5, size: 1.1 }, { x: 70, z: -1170, rot: 3, size: 1 },
];
export const CHURCH = { x: 210, z: 1250, rot: -0.15 };
