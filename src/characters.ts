export type Species = "ibex" | "marmot" | "hare" | "fox" | "chamois";

export interface Character {
  id: Species;
  name: string;
  species: string;
  motto: string;
  color: string;
  fur: number;
  cream: number;
  jacket: number;
  pants: number;
  hat: number;
  skis: number;
}

/** The same cast and colours are used by the picker and the playable models. */
export const CHARACTERS: readonly Character[] = [
  { id: "ibex", name: "Beni", species: "Alpine ibex", motto: "Big horns. Bigger mountain days.", color: "#168c87", fur: 0xa68b70, cream: 0xf6dfb7, jacket: 0x22b9ac, pants: 0x64489a, hat: 0xffa155, skis: 0xff6578 },
  { id: "marmot", name: "Mila", species: "Alpine marmot", motto: "Out of hibernation. Into the powder.", color: "#d95862", fur: 0xb17b4f, cream: 0xffd5a0, jacket: 0xf76676, pants: 0x375d88, hat: 0x64d7c5, skis: 0xffc74b },
  { id: "hare", name: "Lumi", species: "Mountain hare", motto: "A little hop. A whole lot of happy.", color: "#8a62c3", fur: 0xf6f4ed, cream: 0xffffff, jacket: 0xb49aef, pants: 0x755498, hat: 0xffce55, skis: 0x4fcabd },
  { id: "fox", name: "Fynn", species: "Red fox", motto: "First tracks. A little mischief.", color: "#397fc2", fur: 0xe78c3e, cream: 0xffebc8, jacket: 0x448ee4, pants: 0xffbf48, hat: 0xff789e, skis: 0x63d6be },
  { id: "chamois", name: "Nico", species: "Chamois", motto: "Sure feet. Sunny-side adventures.", color: "#b6811e", fur: 0x725744, cream: 0xedd3a1, jacket: 0xffc543, pants: 0xde6a7b, hat: 0x609edc, skis: 0x8a7fe0 },
];
