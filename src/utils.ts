import chroma, { deltaE, Color } from "chroma-js";
import { randomBytes } from "ethers";

type Pixel = [number, number, number];
const toChroma = (p: Pixel) => chroma(p.map((i) => i * 255));

const fantasy_palette = [
  "#000000",
  "#131013",
  "#101024",
  "#390904",
  "#0f1527",
  "#171723",
  "#071e38",
  "#1b1b1b",
  "#391313",
  "#560e05",
  "#33181e",
  "#231a5b",
  "#25212a",
  "#351d20",
  "#0c2197",
  "#252526",
  "#272727",
  "#3c212c",
  "#162c50",
  "#512020",
  "#282d39",
  "#4b2340",
  "#332c30",
  "#731e11",
  "#1b3629",
  "#5e271c",
  "#482b4a",
  "#293836",
  "#3c3633",
  "#343744",
  "#4d3232",
  "#9c1f0c",
  "#303e23",
  "#323a50",
  "#6c2e2b",
  "#3b3b3b",
  "#184450",
  "#4d3744",
  "#234734",
  "#413f46",
  "#364159",
  "#324179",
  "#523c4e",
  "#8b2d4c",
  "#923212",
  "#723756",
  "#653c46",
  "#7a363f",
  "#63402c",
  "#055682",
  "#823b2a",
  "#733e44",
  "#4a4a4a",
  "#b22e2e",
  "#5e4b37",
  "#3e5442",
  "#4d48a3",
  "#544f4f",
  "#af391e",
  "#465926",
  "#4b5367",
  "#69513f",
  "#346132",
  "#864658",
  "#4c5870",
  "#8344a7",
  "#825045",
  "#635945",
  "#38607c",
  "#6d546b",
  "#825737",
  "#5f5f5f",
  "#8e5728",
  "#835761",
  "#af5128",
  "#636a49",
  "#7b6840",
  "#d44e52",
  "#567087",
  "#796699",
  "#7d6c57",
  "#4e7e3a",
  "#786d7b",
  "#b2652e",
  "#5c7a56",
  "#b65d6e",
  "#54814e",
  "#3a7ebb",
  "#92725f",
  "#a87048",
  "#a66d73",
  "#9a745f",
  "#aa735a",
  "#808080",
  "#ba7830",
  "#b0766d",
  "#868831",
  "#f36c52",
  "#d07575",
  "#65929e",
  "#a5857b",
  "#b88450",
  "#ce862c",
  "#c1856d",
  "#a38f80",
  "#55a894",
  "#61a3c7",
  "#ec8a4b",
  "#80ac40",
  "#c58cc6",
  "#b79c71",
  "#be9d58",
  "#32c879",
  "#39c4d0",
  "#80b5c7",
  "#dda677",
  "#94c0d8",
  "#67df53",
  "#8bd0ba",
  "#dfc449",
  "#f0c542",
  "#ddccc6",
  "#ffcc68",
  "#b4d8de",
  "#e1d895",
  "#ffd09e",
  "#d5ea63",
  "#ffffff",
];

const contour_palette = [
  "#050403",
  "#0e0c0c",
  "#2d1b1e",
  "#612721",
  "#b9451d",
  "#f1641f",
  "#fca570",
  "#ffe0b7",
  "#ffffff",
  "#fff089",
  "#f8c53a",
  "#e88a36",
  "#b05b2c",
  "#673931",
  "#271f1b",
  "#4c3d2e",
  "#855f39",
  "#d39741",
  "#f8f644",
  "#d5dc1d",
  "#adb834",
  "#7f8e44",
  "#586335",
  "#333c24",
  "#181c19",
  "#293f21",
  "#477238",
  "#61a53f",
  "#8fd032",
  "#c4f129",
  "#d0ffea",
  "#97edca",
  "#59cf93",
  "#42a459",
  "#3d6f43",
  "#27412d",
  "#14121d",
  "#1b2447",
  "#2b4e95",
  "#2789cd",
  "#42bfe8",
  "#73efe8",
  "#f1f2ff",
  "#c9d4fd",
  "#8aa1f6",
  "#4572e3",
  "#494182",
  "#7864c6",
  "#9c8bdb",
  "#ceaaed",
  "#fad6ff",
  "#eeb59c",
  "#d480bb",
  "#9052bc",
  "#171516",
  "#373334",
  "#695b59",
  "#b28b78",
  "#e2b27e",
  "#f6d896",
  "#fcf7be",
  "#ecebe7",
  "#cbc6c1",
  "#a69e9a",
  "#807b7a",
  "#595757",
  "#323232",
  "#4f342f",
  "#8c5b3e",
  "#c68556",
  "#d6a851",
  "#b47538",
  "#724b2c",
  "#452a1b",
  "#61683a",
  "#939446",
  "#c6b858",
  "#efdd91",
  "#b5e7cb",
  "#86c69a",
  "#5d9b79",
  "#486859",
  "#2c3b39",
  "#171819",
  "#2c3438",
  "#465456",
  "#64878c",
  "#8ac4c3",
  "#afe9df",
  "#dceaee",
  "#b8ccd8",
  "#88a3bc",
  "#5e718e",
  "#485262",
  "#282c3c",
  "#464762",
  "#696682",
  "#9a97b9",
  "#c5c7dd",
  "#e6e7f0",
  "#eee6ea",
  "#e3cddf",
  "#bfa5c9",
  "#87738f",
  "#564f5b",
  "#322f35",
  "#36282b",
  "#654956",
  "#966888",
  "#c090a9",
  "#d4b8b8",
  "#eae0dd",
  "#f1ebdb",
  "#ddcebf",
  "#bda499",
  "#886e6a",
  "#594d4d",
  "#33272a",
  "#b29476",
  "#e1bf89",
  "#f8e398",
  "#ffe9e3",
  "#fdc9c9",
  "#f6a2a8",
  "#e27285",
  "#b25266",
  "#64364b",
  "#2a1e23",
];

const sam_palette = [
  "#ffffff",
  "#ffffb6",
  "#b6ffff",
  "#b6ffb6",
  "#ffb6ff",
  "#ffb6b6",
  "#b6b6ff",
  "#b6b6b6",
  "#dbdbdb",
  "#dbdb92",
  "#92dbdb",
  "#92db92",
  "#db92db",
  "#db9292",
  "#9292db",
  "#929292",
  "#ffff6d",
  "#ffff24",
  "#b6ff6d",
  "#b6ff24",
  "#ffb66d",
  "#ffb624",
  "#b6b66d",
  "#b6b624",
  "#dbdb49",
  "#dbdb00",
  "#92db49",
  "#92db00",
  "#db9249",
  "#db9200",
  "#929249",
  "#929200",
  "#6dffff",
  "#6dffb6",
  "#24ffff",
  "#24ffb6",
  "#6db6ff",
  "#6db6b6",
  "#24b6ff",
  "#24b6b6",
  "#49dbdb",
  "#49db92",
  "#00dbdb",
  "#00db92",
  "#4992db",
  "#499292",
  "#0092db",
  "#009292",
  "#6dff6d",
  "#6dff24",
  "#24ff6d",
  "#24ff24",
  "#6db66d",
  "#6db624",
  "#24b66d",
  "#24b624",
  "#49db49",
  "#49db00",
  "#00db49",
  "#00db00",
  "#499249",
  "#499200",
  "#009249",
  "#009200",
  "#ff6dff",
  "#ff6db6",
  "#b66dff",
  "#b66db6",
  "#ff24ff",
  "#ff24b6",
  "#b624ff",
  "#b624b6",
  "#db49db",
  "#db4992",
  "#9249db",
  "#924992",
  "#db00db",
  "#db0092",
  "#9200db",
  "#920092",
  "#ff6d6d",
  "#ff6d24",
  "#b66d6d",
  "#b66d24",
  "#ff246d",
  "#ff2424",
  "#b6246d",
  "#b62424",
  "#db4949",
  "#db4900",
  "#924949",
  "#924900",
  "#db0049",
  "#db0000",
  "#920049",
  "#920000",
  "#6d6dff",
  "#6d6db6",
  "#246dff",
  "#246db6",
  "#6d24ff",
  "#6d24b6",
  "#2424ff",
  "#2424b6",
  "#4949db",
  "#494992",
  "#0049db",
  "#004992",
  "#4900db",
  "#490092",
  "#0000db",
  "#000092",
  "#6d6d6d",
  "#6d6d24",
  "#246d6d",
  "#246d24",
  "#6d246d",
  "#6d2424",
  "#24246d",
  "#242424",
  "#494949",
  "#494900",
  "#004949",
  "#004900",
  "#490049",
  "#490000",
  "#000049",
  "#000000",
];

const atari_palette = [
  "#000000",
  "#444400",
  "#702800",
  "#841800",
  "#880000",
  "#78005c",
  "#480078",
  "#140084",
  "#000088",
  "#00187c",
  "#002c5c",
  "#00402c",
  "#003c00",
  "#143800",
  "#2c3000",
  "#442800",
  "#404040",
  "#646410",
  "#844414",
  "#983418",
  "#9c2020",
  "#8c2074",
  "#602090",
  "#302098",
  "#1c209c",
  "#1c3890",
  "#1c4c78",
  "#1c5c48",
  "#205c20",
  "#345c1c",
  "#4c501c",
  "#644818",
  "#6c6c6c",
  "#848424",
  "#985c28",
  "#ac5030",
  "#b03c3c",
  "#a03c88",
  "#783ca4",
  "#4c3cac",
  "#3840b0",
  "#3854a8",
  "#386890",
  "#387c64",
  "#407c40",
  "#507c38",
  "#687034",
  "#846830",
  "#909090",
  "#a0a034",
  "#ac783c",
  "#c06848",
  "#c05858",
  "#b0589c",
  "#8c58b8",
  "#6858c0",
  "#505cc0",
  "#5070bc",
  "#5084ac",
  "#509c80",
  "#5c9c5c",
  "#6c9850",
  "#848c4c",
  "#a08444",
  "#b0b0b0",
  "#b8b840",
  "#bc8c4c",
  "#d0805c",
  "#d07070",
  "#c070b0",
  "#a070cc",
  "#7c70d0",
  "#6874d0",
  "#6888cc",
  "#689cc0",
  "#68b494",
  "#74b474",
  "#84b468",
  "#9ca864",
  "#b89c58",
  "#c8c8c8",
  "#d0d050",
  "#cca05c",
  "#e09470",
  "#e08888",
  "#d084c0",
  "#b484dc",
  "#9488e0",
  "#7c8ce0",
  "#7c9cdc",
  "#7cb4d4",
  "#7cd0ac",
  "#8cd08c",
  "#9ccc7c",
  "#b4c078",
  "#d0b46c",
  "#dcdcdc",
  "#e8e85c",
  "#dcb468",
  "#eca880",
  "#eca0a0",
  "#dc9cd0",
  "#c49cec",
  "#a8a0ec",
  "#90a4ec",
  "#90b4ec",
  "#90cce8",
  "#90e4c0",
  "#a4e4a4",
  "#b4e490",
  "#ccd488",
  "#e8cc7c",
  "#ececec",
  "#fcfc68",
  "#fcbc94",
  "#fcb4b4",
  "#ecb0e0",
  "#d4b0fc",
  "#bcb4fc",
  "#a4b8fc",
  "#a4c8fc",
  "#a4e0fc",
  "#a4fcd4",
  "#b8fcb8",
  "#c8fca4",
  "#e0ec9c",
  "#fce08c",
  "#ffffff",
];

const palette = atari_palette;

const finalPalette: any[] = [];
const colorIndex = new Map<any, number>();
const colorHexIndex = new Map<any, string>();
const hexColorIndex = new Map<string, any>();
for (let i = 0; i < palette.length; ++i) {
  const hex = palette[i];
  const color = chroma(hex);
  colorIndex.set(color, i);
  colorHexIndex.set(color, hex);
  hexColorIndex.set(hex, color);
  finalPalette.push(color);
}

const cache: number[][] = [...new Array(128)].map(() => []);
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

let colorMap = new Map<string, Array<string>>();
let iterationCount = 0;
let bestProximity = 1000;
console.log("lets begin!");

const setColors = ["#404040", "#ececec"];

let representation = [];
let proximityCache = new Map<number, string[]>();
while (colorMap.size === 0 || bestProximity > 14) {
  let proximity = 0;
  colorMap = new Map<string, Array<string>>();
  const _palette = [
    ...setColors.map((hex) => hexColorIndex.get(hex)),
    ...[...new Array(14)].map(() => finalPalette[randomBytes(1)[0] % 128]),
  ];
  representation = [];

  for (let i = 0; i < 128; ++i) {
    representation[i] = 0;
  }

  const colorDiffs: { d: number; hex: string }[][] = [];
  for (const p of _palette) {
    const index = colorIndex.get(p) as number;
    const cacheResult = proximityCache.get(index);
    let selectedColors: string[] = [];
    if (cacheResult) {
      selectedColors = cacheResult;
    } else {
      colorDiffs[index] = [];
      for (const color of finalPalette) {
        const _index = colorIndex.get(color) as number;
        colorDiffs[index][_index] = {
          d: colorDiff(p, color),
          hex: colorHexIndex.get(color) as string,
        };
      }
      colorDiffs[index].sort((a, b) => (a.d > b.d ? 1 : -1));
      selectedColors = colorDiffs[index].slice(1, 17).map((a) => a.hex);
      proximityCache.set(index, selectedColors);
    }

    for (const c of selectedColors) {
      representation[colorIndex.get(hexColorIndex.get(c) as Color) as number]++;
    }

    colorMap.set(colorHexIndex.get(p) as string, selectedColors);
  }

  for (let i = 0; i < 128; ++i) {
    if (representation[i] === 0) proximity += 1000;
    proximity += Math.pow(Math.abs(representation[i] - 2) + 1, 2);
  }

  if (proximity < bestProximity) {
    bestProximity = proximity;
    console.log(` -- found new: ${proximity} -- `);
    console.log(_palette.map((p) => colorHexIndex.get(p)));
    console.log(representation);
    const map: any = {};
    for (let c of Array.from(colorMap.keys())) {
      map[c] = colorMap.get(c);
    }
    console.dir(map);
    console.log(` -- /found new: ${proximity} -- `);
  }
  /*

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
    proximity += Math.pow(Math.abs(p.size - 8), 2);
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
  }*/

  if (++iterationCount % 1000000 === 0) {
    console.log(`iteration: ${iterationCount} proximity: ${bestProximity}`);
  }
}

console.log(" -- done --");
