import generateTrajectories from "./captcha_test";
import { dataSlice } from "ethers";
import Database from "./database";
import Paint from "./paint";
import Clock from "./clock";
import chroma from "chroma-js";
import { readFileSync } from "fs";
import GIFEncoder from "gifencoder";
import { NotFoundError, BadRequestError } from "../errors";
import { createCanvas, createImageData } from "canvas";
import { generatePalette, getDistance } from "./utils";

const paletteCache = new Map<string, number[]>();
const drawCanvas = (canvas: Uint8Array, palette: string[]) => {
  const imageData = new Uint8ClampedArray(
    Array.from(canvas).flatMap((i) => {
      const datapoint = palette[i];
      const cacheResult = paletteCache.get(datapoint);
      if (cacheResult) return cacheResult;
      const result = chroma(datapoint).rgba();
      result[3] = 255;

      paletteCache.set(datapoint, result);

      return result;
    })
  );

  return imageData;
};

const processLine = (line: string) => {
  const output = [];

  if (!line) return [];

  const input = line.split(" ").map((i) => parseInt(i));

  for (let i = 0; i < input.length; i += 3) {
    output.push(chroma([input[i], input[i + 1], input[i + 2]]));
  }

  return output;
};

const CAPTCHA_IMAGE_SIZE = 64;
const CAPTCHA_SPEED = 8;
const CAPTCHA_VISIBILITY = 10;
const CAPTCHA_DELAY = 2;

const captchaChallenges = new Map<string, number>();

const generateCaptchaTarget = (
  captchaFile: string,
  palette: string[],
  sequence: number
) => {
  console.log(captchaFile)
  const captchaData = readFileSync(captchaFile)
    .toString()
    .split("\n")
    .map(processLine)
    .filter((i) => i.length > 0);
  const captchaColumns = captchaData.slice(-1)[0].length;
  const captchaRows = captchaData.length;

  const mappings = new Map<number, number>();
  const captchaSolutionData: number[] = [];
  for (let y = 0; y < captchaRows; ++y) {
    for (let x = 0; x < captchaColumns; ++x) {
      let match = -1;
      let matchValue = 100;
      for (let p = 0; p < palette.length; ++p) {
        const d = chroma.distance(captchaData[y][x], palette[p]);
        if (d < matchValue) {
          matchValue = d;
          match = p;
        }
      }
      captchaSolutionData[y * captchaColumns + x] = match;
      mappings.set(match, (mappings.get(match) || 0) + 1);
    }
  }
  const baseColor = Array.from(mappings).sort((a, b) =>
    a[1] > b[1] ? -1 : 1
  )[0][0];

  return {
    startX: Math.floor(Math.random() * (CAPTCHA_IMAGE_SIZE - captchaColumns)),
    startY: Math.floor(Math.random() * (CAPTCHA_IMAGE_SIZE - captchaRows)),
    captchaColumns,
    captchaRows,
    frame: Math.floor(
      (sequence + Math.random()) * CAPTCHA_VISIBILITY +
        CAPTCHA_VISIBILITY +
        CAPTCHA_DELAY * sequence
    ),
    captchaData: captchaSolutionData,
    paintedPixels: new Set(),
    mappings,
    baseColor,
  };
};

const captchaFiles = [
  "./src/modules/captcha1.txt",
  "./src/modules/captcha2.txt",
  "./src/modules/captcha3.txt",
  "./src/modules/captcha4.txt",
  "./src/modules/captcha5.txt",
  "./src/modules/captcha6.txt",
  "./src/modules/captcha7.txt",
  "./src/modules/captcha8.txt",
  "./src/modules/captcha9.txt",
];

const generateCaptcha = () => {
  const t0 = new Date().getTime();
  const palette = generatePalette(16);
  const columns = CAPTCHA_IMAGE_SIZE;
  const rows = CAPTCHA_IMAGE_SIZE;
  const captchaCount = 3 + Math.floor(Math.random() * 5);
  const CAPTCHA_FRAME_COUNT =
    captchaCount * (CAPTCHA_VISIBILITY + 2 * CAPTCHA_DELAY);
  const trajectory = generateTrajectories(
    columns,
    rows,
    CAPTCHA_FRAME_COUNT,
    10
  );

  const t1 = new Date().getTime();
  const captchaFileIndex = Math.floor(Math.random() * 8) + 1;

  let currentTargetIndex = 0;
  const captchaTargets = [
    generateCaptchaTarget(captchaFiles[captchaFileIndex], palette, 0),
    ...[...new Array(captchaCount - 1)].map((_, i) =>
      generateCaptchaTarget(captchaFiles[captchaFileIndex], generatePalette(16), i)
    ),
  ];

  captchaTargets.push({
    baseColor: 0,
    startX: 0,
    startY: 0,
    mappings: new Map(),
    captchaColumns: CAPTCHA_IMAGE_SIZE,
    captchaRows: CAPTCHA_IMAGE_SIZE,
    frame: CAPTCHA_FRAME_COUNT,
    captchaData: [...new Array(CAPTCHA_IMAGE_SIZE * CAPTCHA_IMAGE_SIZE)].map(
      () => captchaTargets[0].baseColor
    ),
    paintedPixels: new Set(),
  });

  console.log(captchaTargets);

  const encoder = new GIFEncoder(CAPTCHA_IMAGE_SIZE, CAPTCHA_IMAGE_SIZE);
  const stream = encoder.createReadStream();
  encoder.setDelay(1000 / CAPTCHA_SPEED);
  encoder.setRepeat(0);
  encoder.start();
  const c = createCanvas(columns, rows);
  const ctx = c.getContext("2d");

  const currentColors: number[] = [];

  for (let frame = 0; frame < CAPTCHA_FRAME_COUNT; frame++) {
    if (
      frame > captchaTargets[currentTargetIndex].frame &&
      currentTargetIndex < captchaTargets.length - 1
    ) {
      currentTargetIndex += 1;
    }

    const currentTarget = captchaTargets[currentTargetIndex];
    const canvas: number[] = [];

    for (let i = 0; i < columns * rows; ++i) {
      const index = trajectory[i][frame];
      const _index = trajectory[i][currentTarget.frame];
      const x = _index % columns;
      const y = (_index - x) / columns;
      const targetColor =
        currentTarget.captchaData[
          x -
            currentTarget.startX +
            (y - currentTarget.startY) * currentTarget.captchaColumns
        ];

      const ratio =
        frame === currentTarget.frame
          ? 1
          : (1 -
              currentTarget.paintedPixels.size /
                (currentTarget.captchaColumns * currentTarget.captchaRows)) /
            (currentTarget.frame - frame);

      if (
        x >= currentTarget.startX &&
        x < currentTarget.startX + currentTarget.captchaColumns &&
        y >= currentTarget.startY &&
        y < currentTarget.startY + currentTarget.captchaRows
      ) {
        if (currentTarget.paintedPixels.has(i)) {
          canvas[index] = targetColor;
          continue;
        } else if (Math.random() < 2 / CAPTCHA_VISIBILITY) {
          // actually here we can measure the amount needed based on distance
          currentColors[i] = canvas[index] = targetColor;
          currentTarget.paintedPixels.add(i);
          continue;
        }
      }

      if (currentColors[i] !== undefined) {
        if (
          currentColors[i] !== currentTarget.baseColor &&
          Math.random() < 0.025
        )
          canvas[index] = currentColors[i] = currentTarget.baseColor;
        else canvas[index] = currentColors[i];
      } else {
        currentColors[i] = canvas[index] = Math.floor(
          Math.random() * palette.length
        );
      }
    }

    ctx.putImageData(
      createImageData(
        drawCanvas(new Uint8Array(canvas), palette),
        columns,
        rows
      ),
      0,
      0
    );

    encoder.addFrame(ctx as any);
  }

  encoder.finish();
  console.log(new Date().getTime() - t1);
  return stream;
};

export default generateCaptcha;
