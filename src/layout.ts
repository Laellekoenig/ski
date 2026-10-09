// Hand-authored layout of the ski area. +z is downhill (towards the valley), the summit sits at -z.

export type V2 = { x: number; z: number };

export interface LiftDef {
  name: string;
  color: number;
  bottom: V2;
  top: V2;
}

export interface PisteDef {
  name: string;
  /** Swiss piste colours: blue / red / black */
  color: number;
  width: number;
  points: V2[];
}

const v = (x: number, z: number): V2 => ({ x, z });

export const BOUNDS = { minX: -450, maxX: 450, minZ: -690, maxZ: 690 };

export const LIFTS: LiftDef[] = [
  { name: "Gipfelbahn", color: 0xe8423f, bottom: v(70, 505), top: v(40, -530) },
  { name: "Arvenlift", color: 0x3d8bd9, bottom: v(-262, 262), top: v(-232, -262) },
  { name: "Sonnenlift", color: 0xf2a93b, bottom: v(272, 335), top: v(242, -138) },
];

export const PISTES: PisteDef[] = [
  {
    name: "Gipfelabfahrt",
    color: 0x2f6fe0,
    width: 40,
    points: [v(40, -505), v(0, -420), v(-60, -300), v(-20, -180), v(60, -60), v(40, 60), v(-30, 180), v(10, 300), v(50, 420), v(62, 490)],
  },
  {
    name: "Arven",
    color: 0xd93434,
    width: 34,
    points: [v(-232, -240), v(-285, -150), v(-220, -40), v(-292, 80), v(-250, 180), v(-262, 248)],
  },
  {
    name: "Sonnenhang",
    color: 0xd93434,
    width: 34,
    points: [v(242, -118), v(180, -30), v(262, 80), v(205, 190), v(272, 320)],
  },
  { name: "Gratweg", color: 0x2f6fe0, width: 30, points: [v(10, -515), v(-110, -430), v(-200, -330), v(-232, -275)] },
  { name: "Sonnenweg", color: 0x2f6fe0, width: 30, points: [v(70, -500), v(170, -330), v(225, -210), v(242, -150)] },
  { name: "Talweg West", color: 0x2f6fe0, width: 32, points: [v(-262, 275), v(-200, 390), v(-70, 470), v(55, 505)] },
  { name: "Talweg Ost", color: 0x2f6fe0, width: 32, points: [v(272, 350), v(210, 445), v(85, 505)] },
  { name: "Schwarzer Hund", color: 0x222222, width: 26, points: [v(-60, -300), v(-140, -200), v(-160, -60), v(-110, 90), v(-30, 180)] },
];

/** Jumps: placed on a piste control point, oriented along the piste. */
export const KICKERS: { piste: number; point: number; height: number }[] = [
  { piste: 0, point: 3, height: 1.8 },
  { piste: 0, point: 5, height: 2.0 },
  { piste: 0, point: 7, height: 1.6 },
  { piste: 1, point: 2, height: 1.8 },
  { piste: 2, point: 2, height: 2.0 },
  { piste: 7, point: 2, height: 2.4 },
];

export const LAKE = { x: -170, z: 600, radius: 72 };

export const CHALETS: { x: number; z: number; rot: number; size: number }[] = [
  { x: 160, z: 575, rot: 0.2, size: 1 },
  { x: 200, z: 620, rot: -0.3, size: 1.2 },
  { x: 250, z: 580, rot: 0.5, size: 0.9 },
  { x: 300, z: 630, rot: 0.1, size: 1.1 },
  { x: 140, z: 640, rot: -0.6, size: 0.9 },
  { x: -60, z: 640, rot: 0.3, size: 1 },
  { x: -300, z: 520, rot: 0.8, size: 1 },
  { x: 330, z: 560, rot: -0.2, size: 1 },
  { x: -10, z: 595, rot: -0.1, size: 1.15 },
];

export const CHURCH = { x: 245, z: 650, rot: -0.15 };
