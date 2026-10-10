export type RiderId = "beni" | "mila" | "rex" | "kenji" | "zoe" | "dex" | "pip";
export type Outfit = "freeride" | "race" | "park" | "alpine";
/** What sits on the head, from novelty knitwear to a toothy shark hood. */
export type Headwear = "hairy-beanie" | "earmuffs" | "mullet" | "race-helmet" | "space-buns" | "bucket-hat" | "shark-hood";
/** The print on the jacket. */
export type Print = "flames" | "quilted" | "memphis" | "lightning" | "holo" | "tiedye" | "shark";

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
  /** second jacket colour: flames, quilting, squiggles, bolts, hoodie or belly */
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
  /** iris colour; defaults to brown */
  eyes?: number;
  /** lip colour; defaults to a darker shade of the skin */
  lips?: number;
  /** padded jacket that bulks out the body and arms */
  puffy?: boolean;
}

/** Four men and three women, each in a loud, turn-of-the-millennium look of their own. */
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
    print: "quilted", headwear: "earmuffs", outfit: "race", height: 0.98, eyes: 0x3f78b4, lips: 0xe0458f, puffy: true,
  },
  {
    id: "rex", name: "Rex", gender: "male", discipline: "Hot Dog",
    motto: "Never left 1986.", kit: "Memphis one-piece / mullet & sweatband / gold aviators",
    color: "#14b3ad", skin: 0xf0b98f, hair: 0xc9944a, jacket: 0xf6f3ea, trim: 0x14b3ad,
    pants: 0x14b3ad, gloves: 0xffd21a, accent: 0xff2f9a, lens: 0xff9a1c, skis: 0xff2f9a,
    print: "memphis", headwear: "mullet", outfit: "alpine", height: 1.03, eyes: 0x3d7fa8,
  },
  {
    id: "kenji", name: "Kenji", gender: "male", discipline: "Downhill",
    motto: "Gold or nothing.", kit: "Lightning speed suit / full-face lid / gold visor",
    color: "#1d4fd8", skin: 0xe8b48c, hair: 0x15110f, jacket: 0x1d4fd8, trim: 0xf4f6f8,
    pants: 0x1d4fd8, gloves: 0xe8202c, accent: 0xe8202c, lens: 0xffb320, skis: 0xf4f6f8,
    print: "lightning", headwear: "race-helmet", outfit: "race", height: 1, eyes: 0x2b1a12,
  },
  {
    id: "zoe", name: "Zoe", gender: "female", discipline: "Slopestyle",
    motto: "Too cute to crash.", kit: "Holographic puffer / space buns & butterfly clips / tiny tints",
    color: "#9a7cff", skin: 0xf6d2bb, hair: 0x7fb4ff, jacket: 0xd9dbe8, trim: 0xb59cff,
    pants: 0xf3f2fa, gloves: 0xc8ccd8, accent: 0x6ff0cf, lens: 0xff7ac8, skis: 0xb59cff,
    print: "holo", headwear: "space-buns", outfit: "race", height: 0.96, eyes: 0x6b4a8f, lips: 0xff6fb0, puffy: true,
  },
  {
    id: "dex", name: "Dex", gender: "male", discipline: "Jib",
    motto: "Flow like water.", kit: "Tie-dye hoodie / bucket hat over locs / round shades",
    color: "#f07a12", skin: 0x6b4430, hair: 0x221510, jacket: 0xf07a12, trim: 0x7b2fbf,
    pants: 0x2d3a5c, gloves: 0x7b2fbf, accent: 0xf2c418, lens: 0x2fbf6a, skis: 0x7b2fbf,
    print: "tiedye", headwear: "bucket-hat", outfit: "park", height: 1.04,
  },
  {
    id: "pip", name: "Pip", gender: "female", discipline: "Park",
    motto: "Smell fear. Go faster.", kit: "Shark onesie / toothy hood / freckles",
    color: "#ff6b5a", skin: 0xf7d6c1, hair: 0xd6532a, jacket: 0x6f8fae, trim: 0xf4f4f0,
    pants: 0x6f8fae, gloves: 0xff6b5a, accent: 0xffd23a, lens: 0x4fc3ff, skis: 0xffd23a,
    print: "shark", headwear: "shark-hood", outfit: "alpine", height: 0.92, eyes: 0x3f8a6a,
  },
];
