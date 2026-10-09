export type RiderId = "beni" | "mila" | "fynn" | "lumi";
export type Outfit = "freeride" | "race" | "park" | "alpine";

export interface Character {
  id: RiderId;
  name: string;
  gender: "male" | "female";
  discipline: string;
  motto: string;
  color: string;
  kit: string;
  jacket: number;
  panel: number;
  pants: number;
  helmet: number;
  accent: number;
  lens: number;
  skis: number;
  outfit: Outfit;
  height: number;
}

/** Two men and two women, each with a complete, recognisable equipment setup. */
export const CHARACTERS: readonly Character[] = [
  {
    id: "beni", name: "Beni", gender: "male", discipline: "Freeride",
    motto: "Find your own line.", kit: "Forest shell / sand cargo / copper mirror",
    color: "#456454", jacket: 0x324f43, panel: 0x202c29, pants: 0xafa18a,
    helmet: 0x262c2b, accent: 0xdb8c42, lens: 0xc7833f, skis: 0x384b3f,
    outfit: "freeride", height: 1.04,
  },
  {
    id: "mila", name: "Mila", gender: "female", discipline: "Piste",
    motto: "Hold the edge. Own the turn.", kit: "Chalk shell / vermilion bib / smoke mirror",
    color: "#b24b33", jacket: 0xe6e2d7, panel: 0xc65335, pants: 0x943924,
    helmet: 0xe3e1d8, accent: 0xe86d3e, lens: 0x697f98, skis: 0xb84d31,
    outfit: "race", height: 0.98,
  },
  {
    id: "fynn", name: "Fynn", gender: "male", discipline: "Park",
    motto: "Make every hit count.", kit: "Cobalt anorak / graphite cargo / ice mirror",
    color: "#3a66a0", jacket: 0x284f8c, panel: 0x182c48, pants: 0x292c32,
    helmet: 0x151b25, accent: 0xb7d7e6, lens: 0x6ea7bc, skis: 0x263d61,
    outfit: "park", height: 1.02,
  },
  {
    id: "lumi", name: "Lumi", gender: "female", discipline: "Backcountry",
    motto: "Go where the tracks end.", kit: "Plum shell / glacier bib / rose mirror",
    color: "#765970", jacket: 0x604155, panel: 0x392f40, pants: 0xc9cfd0,
    helmet: 0xb8c6c9, accent: 0xcba18e, lens: 0xad7687, skis: 0x756073,
    outfit: "alpine", height: 1,
  },
];
