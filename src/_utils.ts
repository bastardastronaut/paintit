import chroma, { deltaE } from "chroma-js";
import { randomBytes } from "ethers";

type Pixel = [number, number, number];
const toChroma = (p: Pixel) => chroma(p.map((i) => i * 255));

const colors = [
  ["00", "24", "49", "6D", "92", "B6", "DB", "FF"],
  ["00", "24", "49", "6D", "92", "B6", "DB", "FF"],
  ["00", "55", "AA", "FF"],
];

const finalPalette: any[] = [];
let i = 0;
const colorIndex = new Map<any, number>();
const colorHexIndex = new Map<any, string>();
const hexColorIndex = new Map<string, any>();
for (let r = 0; r < 8; ++r) {
  for (let g = 0; g < 8; ++g) {
    for (let b = 0; b < 4; ++b) {
      const hex = `#${colors[0][r]}${colors[1][g]}${colors[2][b]}`;
      const color = chroma(hex);
      colorIndex.set(color, i++);
      colorHexIndex.set(color, hex);
      hexColorIndex.set(hex, color);
      finalPalette.push(color);
    }
  }
}

const cache: number[][] = [...new Array(256)].map(() => []);
function colorDiff(color1: any, color2: any): number {
  const i1 = colorIndex.get(color1) as number;
  const i2 = colorIndex.get(color2) as number;
  const cacheResult = cache[i1][i2];

  if (cacheResult !== undefined) {
    return cacheResult;
  }

  const diff = deltaE(color1, color2);

  cache[i1][i2] = diff;
  cache[i2][i1] = diff;

  return diff;
}

let colorMap = new Map<string, Set<string>>();
let iterationCount = 0;
let bestProximity = 100000;
console.log("lets begin!");

const setColors = [
  "#006D55",
  "#DBDBFF",
  "#DBB600",
  "#B6FF00",
  "#4924AA",
  "#922455",
  "#24DB00",
  "#4900FF",
  "#DB00AA",
  "#DB6D00",
  "#00DBAA",
  "#DB6DAA",
  "#FF4955",
  "#2449AA",
  "#24B600",
  "#00B6AA",
];
const _palette = setColors.map((hex) => hexColorIndex.get(hex));
for (const color of finalPalette) {
  let closestDistance = 1000;
  let closestPaletteIndex = -1;
  for (let p = 0; p < _palette.length; ++p) {
    const distance = colorDiff(_palette[p], color);
    if (distance < closestDistance) {
      closestPaletteIndex = p;
      closestDistance = distance;
    }
  }

  const selectedHex = colorHexIndex.get(
    _palette[closestPaletteIndex]
  ) as string;
  const colorHex = colorHexIndex.get(color) as string;

  const set = colorMap.get(selectedHex);

  if (set) {
    set.add(colorHex);
  } else {
    colorMap.set(selectedHex, new Set([colorHex]));
  }
}

const getColors = (hex: string): any => Array.from(colorMap.get(hex) as any);

for (const c of getColors(setColors[2])) {
  console.log(
    `c: ${c}
    originald: ${colorDiff(
      hexColorIndex.get(setColors[2]),
      hexColorIndex.get(c)
    )}
    newD: ${colorDiff(
      hexColorIndex.get(setColors[3]),
      hexColorIndex.get(c)
    )}`
  );
}

console.log(setColors.map((p) => colorMap.get(p)!.size));

/*

while (colorMap.size === 0 || bestProximity > 14) {
  let proximity = 0;
  const _palette = [...setColors.map((hex) => hexColorIndex.get(hex))];
  colorMap = new Map<string, Set<string>>();
  for (const color of finalPalette) {
    let closestDistance = 1000;
    let closestPaletteIndex = -1;
    for (let p = 0; p < _palette.length; ++p) {
      const distance = colorDiff(_palette[p], color);
      if (distance < closestDistance) {
        closestPaletteIndex = p;
        closestDistance = distance;
      }
    }

    const selectedHex = colorHexIndex.get(_palette[closestPaletteIndex]) as string
    const colorHex = colorHexIndex.get(color) as string

    const set = colorMap.get(selectedHex);

    if (set) {
      set.add(colorHex);
    } else {
      colorMap.set(selectedHex, new Set([colorHex]));
    }
  }

  for (const p of Array.from(colorMap.values())) {
    proximity += Math.pow(Math.abs(p.size - 16), 2);
  }

  if (proximity < bestProximity) {
    bestProximity = proximity;
    console.log(` -- found new: ${proximity} -- `);
    console.log(_palette.map((p) => colorHexIndex.get(p)));
    const map: any = {}
    for (let c of Array.from(colorMap.keys())) {
      map[c] = Array.from(colorMap.get(c) as Set<string>)
    }

    console.log(map)
    console.log(" --  -- ");
  }

  if (++iterationCount % 1000000 === 0) {
    console.log(`iteration: ${iterationCount} proximity: ${bestProximity}`);
  }
}*/

console.log(" -- done --");
