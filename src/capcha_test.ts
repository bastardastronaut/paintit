import { dataSlice } from "ethers";
import chroma from "chroma-js";
import { readFileSync } from "fs";
import GIFEncoder from "gifencoder";
import { createCanvas, createImageData } from "canvas";
import { generatePalette, getDistance } from "./modules/utils";

import palettes from "./palettes";

const MOVE_FREQUENCY = 15;

const processLine = (line: string) => {
  const output = [];

  if (!line) return [];

  const input = line.split(" ").map((i) => parseInt(i));

  for (let i = 0; i < input.length; i += 3) {
    output.push(chroma([input[i], input[i + 1], input[i + 2]]));
  }

  return output;
};
const captchaData = readFileSync("./src/modules/captcha1.txt")
  .toString()
  .split("\n")
  .map(processLine)
  .filter((i) => i.length > 0);

const captchaColumns = captchaData.slice(-1)[0].length;
const captchaRows = captchaData.length;
const captchaChallenges = new Map<string, number>();
const rotateRow = (
  trajectory: number[][],
  frameNumber: number,
  columns: number,
  row: number,
  _rotation = 1,
  direction = 1
) => {
  const getPixel = (index: number) => {
    return trajectory[index][frameNumber] === undefined
      ? trajectory[index][frameNumber - 1]
      : trajectory[index][frameNumber];
  };

  const rotation = direction * (_rotation - MOVE_FREQUENCY);
  if (frameNumber % rotation !== 0) {
    for (let column = 0; column < columns; ++column) {
      const index = row * columns + column;
      trajectory[index][frameNumber] = getPixel(index);
    }
    return;
  }

  let tmp = getPixel(columns * row);

  console.log(
    `rotating row ${row} ${rotation < 0 ? "-" : "+"} at ${frameNumber}`
  );
  for (let column = 0; column < columns; ++column) {
    const index = row * columns + column;
    let nextPixel = 0;

    if (rotation < 0) {
      let nextIndex = index + 1;
      nextPixel = nextIndex % columns === 0 ? tmp : getPixel(nextIndex);
    } else {
      nextPixel = column === 0 ? getPixel((row + 1) * columns - 1) : tmp;
      tmp = getPixel(index);
    }

    console.log(trajectory);
    trajectory[nextPixel][frameNumber] = index;
  }
  console.log();
};
const rotateColumn = (
  trajectory: number[][],
  frameNumber: number,
  columns: number,
  column: number,
  _rotation = 1,
  direction = 1
) => {
  const rows = trajectory.length / columns;

  const getPixel = (index: number) => {
    return trajectory[index][frameNumber] === undefined
      ? trajectory[index][frameNumber - 1]
      : trajectory[index][frameNumber];
  };

  const rotation = direction * (_rotation - MOVE_FREQUENCY);

  if (frameNumber % rotation !== 0) {
    for (let row = 0; row < rows; ++row) {
      const index = row * columns + column;
      trajectory[index][frameNumber] = getPixel(index);
    }
    return;
  }

  let tmp = getPixel(column);

  console.log(
    `rotating column ${column} ${rotation < 0 ? "-" : "+"} at ${frameNumber}`
  );
  for (let row = 0; row < rows; ++row) {
    const index = row * columns + column;
    let nextPixel = 0;
    if (rotation < 0) {
      let nextIndex = index + columns;
      nextPixel = nextIndex >= columns * rows ? tmp : getPixel(nextIndex);
    } else {
      nextPixel = row === 0 ? getPixel((rows - 1) * columns + column) : tmp;
      tmp = getPixel(index);
    }

    console.log(trajectory);

    trajectory[nextPixel][frameNumber] = index;
  }
  console.log();
};

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

const CAPTCHA_2_IMAGE_SIZE = 96;
const CAPTCHA_3_IMAGE_SIZE = 4;
const CAPTCHA_3_FRAME_COUNT = 250;

const generateCaptcha4 = () => {
  const columns = CAPTCHA_3_IMAGE_SIZE;
  const rows = CAPTCHA_3_IMAGE_SIZE;
  const palette = generatePalette(16);
  // const palette = palettes[0];
  const encoder = new GIFEncoder(CAPTCHA_3_IMAGE_SIZE, CAPTCHA_3_IMAGE_SIZE);
  const stream = encoder.createReadStream();
  //let canvas = paint.generateDrawing(palette, columns, rows, 1);

  const finalFrame =
    10 + Math.floor(Math.random() * (CAPTCHA_3_FRAME_COUNT - 10));
  const startX = Math.floor(Math.random() * (columns - captchaColumns));
  const startY = Math.floor(Math.random() * (rows - captchaRows));
  const endX = startX + captchaColumns;
  const endY = startY + captchaRows;

  const rowRotations = [...new Array(rows)].map(() =>
    Math.round(Math.random() * MOVE_FREQUENCY * 2)
  );
  const columnRotations = [...new Array(columns)].map(() =>
    Math.round(Math.random() * MOVE_FREQUENCY * 2)
  );

  const mappings = new Map<number, number>();
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
      mappings.set(match, (mappings.get(match) || 0) + 1);
    }
  }

  // TODO: might do statistical analysis to make sure that over 50% of image is hidden
  const SKIP = Array.from(mappings).sort((a, b) =>
    a[1] > b[1] ? -1 : 1
  )[0][0];

  const canvas = new Uint8Array([...new Array(columns * rows)].map(() => SKIP));

  const initialCanvas = canvas.slice();

  const paletteCache = new Map<string, number[]>();

  const t2 = new Date().getTime();

  /*
  const drawCanvas = (canvas: Uint8Array) => {
    const imageData = new Uint8ClampedArray(
      Array.from(canvas).flatMap((i) => {
        const datapoint =
          Math.random() < 0.1
            ? palette[Math.floor(Math.random() * palette.length)]
            : palette[i];

        const cacheResult = paletteCache.get(datapoint);
        if (cacheResult) return cacheResult;
        const result = chroma(datapoint).rgba();
        result[3] = 255;

        paletteCache.set(datapoint, result);

        return result;
      })
    );

    ctx.putImageData(createImageData(imageData, columns, rows), 0, 0);

    encoder.addFrame(ctx as any);
  };*/

  // this data structure should allow us to track pixels
  // where is the pixel at frame Y that is going to be there at frame X
  // with predefined trajectories the whole thing can be much faster
  // the entire canvas is basicaly just going to be driven by the trajectory
  // well, still need to draw..
  const buildTrajectory = (
    columnRotations: number[],
    rowRotations: number[]
  ) => {
    const t0 = new Date().getTime();
    const trajectory: number[][] = [];
    const imageSize = columnRotations.length * rowRotations.length;
    for (let i = 0; i < imageSize; ++i) {
      // "labeling" pixels
      trajectory[i] = [i];
    }
    // console.log(trajectory);
    for (let frame = 1; frame < CAPTCHA_3_FRAME_COUNT; ++frame) {
      const currentFrame = [];
      for (let row = 0; row < rows; ++row) {
        rotateRow(trajectory, frame, columns, row, rowRotations[row]);
      }
      for (let column = 0; column < columns; ++column) {
        rotateColumn(
          trajectory,
          frame,
          columns,
          column,
          columnRotations[column]
        );
      }
    }

    /*
    for (
      let frameNumber = 0;
      frameNumber < CAPTCHA_3_FRAME_COUNT;
      ++frameNumber
    ) {
      const frame: number[] = [];
      console.log(frame);
    }
    */

    console.log(new Date().getTime() - t0);

    return trajectory;
  };

  const trajectory = buildTrajectory(columnRotations, rowRotations);

  // now we know where each pixel is going.
  // let's try and assign colors to them
  // let's say that initially pixels will blue and red and they can disperse
  // at frame 25 the red will turn green and the blue yellow
  //
  encoder.setDelay(1000 / 24);
  encoder.setRepeat(0);
  encoder.start();

  const t1 = new Date().getTime();
  console.log("reconstruct");

  const c = createCanvas(columns, rows);
  const ctx = c.getContext("2d");

  const captchaSolutionSize = 32;
  const _startX = 10;
  const _startY = 10;
  const _endX = _startX + captchaSolutionSize;
  const _endY = _startY + captchaSolutionSize;
  const captchaSolutionData = [
    ...new Array(captchaSolutionSize * captchaSolutionSize),
  ].map(() => 2);
  const captchaFrame = 100;

  let prevPosition = 0;
  const getPosition = (i: number) => {
    const x = i % columns;
    const y = (i - x) / columns;
    return [x, y];
  };
  console.log(
    trajectory[100].map((p, i) => {
      const d = getDistance(columns, p, prevPosition);
      if (d > 10 && i !== 0) {
        console.log(i, getPosition(p), getPosition(prevPosition), d);
      }
      prevPosition = p;
      return d;
    })
  );

  for (let frame = 0; frame < CAPTCHA_3_FRAME_COUNT; frame++) {
    const canvas = [];
    for (let i = 0; i < columns * rows; ++i) {
      /*
       * this tells me
       * the original color 7 is at position 13 at frame 10
       * original 13 is at position 12 at frame 100
       *
       * what I'm actually looking for is where will 7 be at frame 100
       * */
      const index = trajectory[i][frame];
      const _index = trajectory[i][captchaFrame];
      const x = _index % columns;
      const y = (_index - x) / columns;
      const targetColor =
        captchaSolutionData[x - _startX + (y - _startY) * captchaSolutionSize];
      if (x >= _startX && x < _endX && y >= _startY && y < _endY) {
        //canvas[index] = targetColor
        continue;
      }

      canvas[index] = trajectory[index][frame] > (columns * rows) / 2 ? 1 : 0;
    }

    ctx.putImageData(
      createImageData(
        drawCanvas(new Uint8Array(canvas), ["#ff0000", "#0000ff", "#00ff00"]),
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

  /*
    captchas2.set(challengeId, {
      identity,
      tries: 0,
      solution: startY * CAPTCHA_IMAGE_SIZE + startX,
      imageData,
      targetImageData,
    });

    clock.in(CAPTCHA_TIMEOUT).then(() => captchas.delete(challengeId));*/

  return stream;
};

const testRotations = () => {
  const trajectory: number[][] = [];
  const rows = 3;
  const columns = 3;
  const rowRotations = [...new Array(rows)].map(() =>
    Math.round(Math.random() * MOVE_FREQUENCY * 2)
  );
  const columnRotations = [...new Array(columns)].map(() =>
    Math.round(Math.random() * MOVE_FREQUENCY * 2)
  );
  const imageSize = columnRotations.length * rowRotations.length;
  for (let i = 0; i < imageSize; ++i) {
    trajectory[i] = [i];
  }
  const getPosition = (i: number) => {
    const x = i % columns;
    const y = (i - x) / columns;
    return [x, y];
  };

  const getFrame = (frame: number) => {
    const f = [];
    for (let y = 0; y < rows; ++y) {
      const a = [];
      for (let x = 0; x < columns; ++x) {
        const index = y * columns + x;
        const p = trajectory[index][frame];
        const pp = trajectory[index][frame - 1];
        const [ix, iy] = getPosition(p);
        const [px, py] = getPosition(pp);
        const d = getDistance(columns, pp, p);

        if (
          d > 2 &&
          px !== columns - 1 &&
          px !== 0 &&
          ix !== columns - 1 &&
          ix !== 0 &&
          py !== rows - 1 &&
          py !== 0 &&
          iy !== rows - 1 &&
          iy !== 0
        ) {
          console.log(trajectory);
          console.log(index, frame, pp, p, [px, py], [ix, iy], d);
          throw new Error("nope");
        }
        a[trajectory[index][frame]] = index;
      }
      f.push(a);
    }
    return f;
  };
  const getFrame2 = (frame: number) => {
    const p = [];
    for (let i = 0; i < imageSize; ++i) {
      p[trajectory[i][frame - 1]] = i;
    }
    return p;
  };
  for (let frame = 1; frame < 200; ++frame) {
    const currentFrame = [];
    console.log(`new frame ${frame}`);
    console.log(getFrame2(frame - 1));
    for (let row = 0; row < rows; ++row) {
      rotateRow(trajectory, frame, columns, row, rowRotations[row]);
    }
    /*
    for (let column = 0; column < columns; ++column) {
      rotateColumn(trajectory, frame, columns, column, columnRotations[column]);
    }*/
    //console.log(getFrame(frame));
    //console.log();
  }

  // console.log(trajectory);
  let prevPosition = 0;

  trajectory.map((frames, start) =>
    frames.map((p, i) => {
      const d = getDistance(columns, p, prevPosition);
      if (d > 2 && i !== 0) {
        const [ix, iy] = getPosition(p);
        const [px, py] = getPosition(prevPosition);
        if (
          px !== columns - 1 &&
          px !== 0 &&
          ix !== columns - 1 &&
          ix !== 0 &&
          py !== rows - 1 &&
          py !== 0 &&
          iy !== rows - 1 &&
          iy !== 0
        )
          console.log(start, i, prevPosition, p, [px, py], [ix, iy], d);
      }
      prevPosition = p;
      return d;
    })
  );
};

const _rotateRow2 = (
  trajectory: number[][],
  frameNumber: number,
  columns: number,
  row: number,
  _rotation = 1,
  direction = 1
) => {
  const getPixel = (index: number) => {
    return trajectory[index][frameNumber] === undefined
      ? trajectory[index][frameNumber - 1]
      : trajectory[index][frameNumber];
  };

  const rotation = direction * (_rotation - MOVE_FREQUENCY);
  if (frameNumber % rotation !== 0) {
    for (let column = 0; column < columns; ++column) {
      const index = row * columns + column;
      trajectory[index][frameNumber] = getPixel(index);
    }
    return;
  }

  let tmp = getPixel(columns * row);

  console.log(
    `rotating row ${row} ${rotation < 0 ? "-" : "+"} at ${frameNumber}`
  );
  for (let column = 0; column < columns; ++column) {
    const index = row * columns + column;
    let nextPixel = 0;

    if (rotation < 0) {
      let nextIndex = index + 1;
      nextPixel = nextIndex % columns === 0 ? tmp : getPixel(nextIndex);
    } else {
      nextPixel = column === 0 ? getPixel((row + 1) * columns - 1) : tmp;
      tmp = getPixel(index);
    }

    trajectory[nextPixel][frameNumber] = index;
  }
};

const buildFrame = (
  trajectory: number[][],
  frameNumber: number,
  imageSize: number
) => {
  const frame = [];
  for (let i = 0; i < imageSize; ++i) {
    frame[trajectory[i][frameNumber]] = i;
  }
  return frame;
};

const rotateRow2 = (
  trajectory: number[][],
  frame: number[],
  columns: number,
  row: number,
  rotation: number
) => {
  console.log(`rotating row ${row} ${rotation < 0 ? "-" : "+"}`);
  console.log(frame);
  for (let column = 0; column < columns; ++column) {
    const index = frame[row * columns + column]
    if (rotation < 0) {
    } else {
      console.log(index)
    }
  }
};

const testRotations2 = () => {
  const trajectory = [[0], [1], [2], [3], [4], [5], [6], [7], [8]];
  const frame = buildFrame(trajectory, 0, 9);
  rotateRow2(trajectory, frame, 3, 1, 1);
};

testRotations2();
// generateCaptcha4();
export default generateCaptcha4;

/*
 *  what you are actually storing is this
 *  current pixel's history
 *  who has been here
 *
 *  what you need where has this one gone
 * */
