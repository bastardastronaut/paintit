import { readFileSync } from "fs";
import { dataSlice } from "ethers";
import chroma from "chroma-js";
import { generatePalette } from "./utils";

const processLine = (line: string) => {
  const output = [];

  if (!line) return [];

  const input = line.split(" ").map((i) => parseInt(i));

  for (let i = 0; i < input.length; i += 3) {
    output.push(chroma([input[i], input[i + 1], input[i + 2]]));
  }

  return output;
};

const getRandomColor = (palette: string[], colorIndex: number) => {
  const c = chroma(palette[colorIndex]);
  return palette
    .map((hex, i) => [i, chroma.distance(c, chroma(hex))])
    .sort((a, b) => (a[1] > b[1] ? -1 : 1))[2][0];
};

const generateCaptcha = (
  n = 9,
  randomPixelCount = 5,
  surroundingRandomPixelCount = 5
) => {
  const filename = `captcha${Math.floor(Math.random() * 19)}.txt`;
  //const filename = "captcha9.txt";
  const captchaData = readFileSync(`./src/modules/${filename}`)
    .toString()
    .split("\n")
    .map(processLine)
    .filter((i) => i.length > 0);

  const captchaColumns = captchaData.slice(-1)[0].length;
  const captchaRows = captchaData.length;
  const palettes = [...new Array(n)].map(() => generatePalette(16));
  const paletteIndex = Math.floor(Math.random() * n);
  const palette = palettes[paletteIndex];
  const canvasArray = [
    captchaColumns,
    captchaRows,
    ...palette.map((c) => chroma(c).rgb()).flatMap((i) => i),
  ];

  const imageSize = captchaRows * captchaColumns;
  const solution = {
    paletteIndex,
    randomPoints: new Map<number, number>(),
  };

  let seek = canvasArray.length;
  const getIndex = (x: number, y: number) => seek + x + y * captchaColumns;
  for (let _palette of palettes) {
    for (let y = 0; y < captchaRows; ++y) {
      for (let x = 0; x < captchaColumns; ++x) {
        let match = -1;
        let matchValue = 100;
        for (let p = 0; p < _palette.length; ++p) {
          const d = chroma.deltaE(captchaData[y][x], _palette[p]);
          if (d < matchValue) {
            matchValue = d;
            match = p;
          }
        }
        canvasArray.push(match);
      }
    }

    // put 5 points randomly at places that are surrounded by others of similar
    // xxx
    // xyx
    // xxx

    const randomPoints =
      _palette === palette ? solution.randomPoints : new Map<number, number>();
    while (randomPoints.size < surroundingRandomPixelCount) {
      const x = Math.floor(Math.random() * (captchaColumns - 1));
      const y = Math.floor(Math.random() * (captchaRows - 1));
      const index = getIndex(x, y);
      const color = canvasArray[index];

      let safe = true;
      for (let _x = x - 1; _x < x + 1; ++_x) {
        for (let _y = y - 1; _y < y + 1; ++_y) {
          const _index = getIndex(_x, _y);
          if (canvasArray[_index] !== color) safe = false;
        }
      }

      if (safe) {
        randomPoints.set(index, color);
        canvasArray[index] = getRandomColor(_palette, color);
      }
    }

    // and then find 5 random points of which 2 should be fixed
    for (let i = 0; i < randomPixelCount; ++i) {
      const index = seek + Math.floor(Math.random() * imageSize);
      randomPoints.set(index, canvasArray[index]);
      canvasArray[index] = getRandomColor(palette, canvasArray[index]);
    }

    seek += imageSize;
  }

  const challenge = new Uint8Array(canvasArray);

  return { solution, challenge, filename };
};

export default generateCaptcha;
