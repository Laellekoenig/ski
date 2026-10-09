export type RiderId = "beni" | "mila" | "fynn" | "lumi";
export type Outfit = "freeride" | "race" | "park" | "alpine";
/** What sits on the head, from novelty knitwear to a fuzzy-crested lid. */
export type Headwear = "hairy-beanie" | "earmuffs" | "backwards-cap" | "mohawk-helmet";
/** The print on the jacket. */
export type Print = "flames" | "quilted" | "camo" | "colorblock";

export interface Character {
  id: RiderId;
  name: string;
  gender: "male" | "female";
  discipline: string;
  motto: string;
  color: string;
  kit: string;
  skin: number;
  hair: number;
  jacket: number;
  /** second jacket colour: flames, quilting lines, camo blotches or colour blocks */
  trim: number;
  pants: number;
  gloves: number;
  /** caps, bands, lids and other small loud bits */
  accent: number;
  lens: number;
  skis: number;
  print: Print;
  headwear: Headwear;
  outfit: Outfit;
  height: number;
}

/** Two men and two women, each in a loud, early-2000s look of their own. */
export const CHARACTERS: readonly Character[] = [
  {
    id: "beni", name: "Beni", gender: "male", discipline: "Freeride",
    motto: "Welcome to the summit.", kit: "Flame shell / fake-hair beanie / shades on the back",
    color: "#d0262e", skin: 0xe2a47c, hair: 0x4a3121, jacket: 0x17171b, trim: 0xe8182c,
    pants: 0x3a3c42, gloves: 0xd9301b, accent: 0xffc21a, lens: 0xe0461c, skis: 0xd8361b,
    print: "flames", headwear: "hairy-beanie", outfit: "freeride", height: 1.04,
  },
  {
    id: "mila", name: "Mila", gender: "female", discipline: "Piste",
    motto: "Hold the edge. Own the turn.", kit: "Bubblegum puffer / fluffy earmuffs / white shades",
    color: "#d9358b", skin: 0xf2c9ad, hair: 0xf3e0a8, jacket: 0xff4fae, trim: 0xd12f86,
    pants: 0xf2f0f2, gloves: 0xf4f2f4, accent: 0xff4fae, lens: 0xff6cc0, skis: 0xf1eff1,
    print: "quilted", headwear: "earmuffs", outfit: "race", height: 0.98,
  },
  {
    id: "fynn", name: "Fynn", gender: "male", discipline: "Park",
    motto: "Make every hit count.", kit: "Acid tall tee / camo cargo / backwards flat brim",
    color: "#5f9e1c", skin: 0xc68a5f, hair: 0xf0d27a, jacket: 0x9bdc28, trim: 0x15191c,
    pants: 0x6f6a45, gloves: 0x15191c, accent: 0xff6a13, lens: 0x4fc3ff, skis: 0x9bdc28,
    print: "camo", headwear: "backwards-cap", outfit: "park", height: 1.02,
  },
  {
    id: "lumi", name: "Lumi", gender: "female", discipline: "Backcountry",
    motto: "Go where the tracks end.", kit: "Colour-block one-piece / mohawk lid / chrome mirror",
    color: "#168a99", skin: 0x8d5a3b, hair: 0x241713, jacket: 0x21b8c9, trim: 0x6b3fa0,
    pants: 0x6b3fa0, gloves: 0xffd23a, accent: 0xff4fd8, lens: 0x6f8cff, skis: 0x6b3fa0,
    print: "colorblock", headwear: "mohawk-helmet", outfit: "alpine", height: 1,
  },
];
