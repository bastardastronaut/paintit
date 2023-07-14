import { sha256 } from "ethers";
import chroma from "chroma-js";
import { createCanvas, createImageData } from "canvas";

type NoiseAlgorithm = (
  rows: number,
  columns: number,
  palette: string[]
) => Uint8Array;

// we can actually pick any 16 colors
const NOISE_PALETTE_SIZE = 16;

const noiseAlgorithms: NoiseAlgorithm[] = [
  (rows, columns, palette) => {
    const canvas = new Uint8Array(rows * columns);

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < columns; j++) {
        canvas[i * columns + j] = Math.floor(
          Math.random() * NOISE_PALETTE_SIZE
        );
      }
    }

    return canvas;
  },

  (rows, columns, palette) => {
    const colorMap = [...new Array(NOISE_PALETTE_SIZE)].map((_, i) =>i
      //Math.floor(Math.random() * 128)
    );
    const controlPoints = [
      ...new Array(Math.floor((rows * columns) / 1024)),
    ].map(() => Math.floor(Math.random() * columns * rows));

    const cache: number[][] = [...new Array(128)].map(() => []);
    function colorDiff(i1: number, i2: number): number {
      const color1 = palette[i1];
      const color2 = palette[i2];
      const cacheResult = cache[i1][i2];

      if (cacheResult !== undefined) {
        return cacheResult;
      }

      const diff = chroma.deltaE(color1, color2);

      cache[i1][i2] = diff;
      cache[i2][i1] = diff;

      return diff;
    }

    const canvas = new Uint8Array(rows * columns);
    const setPixels = new Uint8Array(rows * columns);

    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < columns; j++) {
        canvas[i * columns + j] = Math.floor(
          Math.random() * NOISE_PALETTE_SIZE
        );
      }
    }

    for (const controlPoint of controlPoints) {
      canvas[controlPoint] =
        colorMap[Math.floor(Math.random() * NOISE_PALETTE_SIZE)];
      const row = Math.floor(controlPoint / columns);
      const column = controlPoint % columns;

      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < columns; j++) {
          const index = i * columns + j;
          const distance =
            Math.sqrt(Math.pow(i - row, 2) + Math.pow(j - column, 2)) /
            Math.sqrt(Math.pow(rows, 2) + Math.pow(columns, 2));

          const color =
            colorMap[Math.floor(Math.random() * NOISE_PALETTE_SIZE)];
          const colorDistance = colorDiff(color, canvas[controlPoint]) / 100;

          const commitment = distance * colorDistance * 255;

          if (commitment > setPixels[index]) {
            setPixels[index] = commitment;
            canvas[index] = color;
          }
        }
      }
    }

    return canvas;
  },
];

export default class Paint {
  generateDrawing(
    palette: string[],
    rows: number,
    columns: number,
    noiseAlgorithm: number
  ) {
    return noiseAlgorithms[noiseAlgorithm](rows, columns, palette);
  }
}
