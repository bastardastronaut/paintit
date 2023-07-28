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

import palettes from "../palettes";
const processLine = (line: string) => {
  const output = [];

  if (!line) return [];

  const input = line.split(" ").map((i) => parseInt(i));

  for (let i = 0; i < input.length; i += 3) {
    output.push(chroma([input[i], input[i + 1], input[i + 2]]));
  }

  return output;
};

const paletteCache = new Map<string, number[]>();
const _drawCanvas = (canvas: Uint8Array, palette: string[]) => {
  const imageData = new Uint8ClampedArray(
    Array.from(canvas).flatMap((i) => {
      const datapoint =
        Math.random() < 0.0
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

  return createImageData(imageData, CAPTCHA_2_IMAGE_SIZE, CAPTCHA_2_IMAGE_SIZE);
};

const CAPTCHA_2_IMAGE_SIZE = 96;
const CAPTCHA_3_IMAGE_SIZE = 64;
const CAPTCHA_3_FRAME_COUNT = 48;

const CAPTCHA_PROXIMITY = 3;
const CAPTCHA_MAX_TRIES = 3;
// TODO: for testing only
const CAPTCHA_TIMEOUT = 3600;
const CAPTCHA_IMAGE_SIZE = 256;
// instead of this, we can just take the most popular color and turn it into noise
const captchaData = readFileSync("./src/modules/captcha8.txt")
  .toString()
  .split("\n")
  .map(processLine)
  .filter((i) => i.length > 0);

const captchaColumns = captchaData.slice(-1)[0].length;
const captchaRows = captchaData.length;
const captchaChallenges = new Map<string, number>();
const captchas = new Map<
  string,
  {
    identity: string;
    solution: number;
    tries: number;
    imageData: Uint8ClampedArray;
    targetImageData: Uint8ClampedArray;
  }
>();
const captchas2 = new Map<
  string,
  {
    identity: string;
    solution: number;
    challenge: ArrayBuffer;
  }
>();

const captchaTries = new Map<string, number>();

const rotateColumn = (
  canvas: Uint8Array,
  columns: number,
  column: number,
  direction = 1
) => {
  const rows = canvas.length / columns;
  let tmp = canvas[column];

  for (let row = 0; row < rows; ++row) {
    const index = row * columns + column;
    let nextPixel = 0;
    if (direction < 0) {
      let nextIndex = index + columns;
      nextPixel = nextIndex >= columns * rows ? tmp : canvas[nextIndex];
    } else {
      nextPixel = row === 0 ? canvas[(rows - 1) * columns + column] : tmp;
      tmp = canvas[index];
    }
    canvas[index] = nextPixel;
  }
};

const rotateRow = (
  canvas: Uint8Array,
  columns: number,
  row: number,
  direction = 1
) => {
  let tmp = canvas[columns * row];

  for (let column = 0; column < columns; ++column) {
    const index = row * columns + column;
    let nextPixel = 0;
    if (direction < 0) {
      let nextIndex = index + 1;
      nextPixel =
        nextIndex % CAPTCHA_2_IMAGE_SIZE === 0 ? tmp : canvas[nextIndex];
    } else {
      nextPixel = column === 0 ? canvas[(row + 1) * columns - 1] : tmp;
      tmp = canvas[index];
    }
    canvas[index] = nextPixel;
  }
};

export default (clock: Clock, database: Database, paint: Paint) => {
  const generateCaptcha5 = (identity: string) => {
    const captchaData = readFileSync(
      `./src/modules/captcha${Math.floor(Math.random() * 7 + 1)}.txt`
    )
      .toString()
      .split("\n")
      .map(processLine)
      .filter((i) => i.length > 0);

    const captchaColumns = captchaData.slice(-1)[0].length;
    const captchaRows = captchaData.length;
    const palettes = [...new Array(9)].map(() => generatePalette(16));
    const paletteIndex = Math.floor(Math.random() * 9);
    const palette = palettes[paletteIndex];
    const canvasArray = [
      captchaColumns,
      captchaRows,
      ...palette.map((c) => chroma(c).rgb()).flatMap((i) => i),
    ];
    const challengeId = dataSlice(identity, 0, 4);

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
    }

    const challenge = new Uint8Array(canvasArray);

    captchas2.set(challengeId, {
      identity,
      solution: paletteIndex,
      challenge: challenge.buffer,
    });

    console.log(challengeId);

    clock.in(CAPTCHA_TIMEOUT).then(() => captchas2.delete(challengeId));

    return challenge;
  };

  const generateCaptcha3 = () => {
    const columns = CAPTCHA_2_IMAGE_SIZE;
    const rows = CAPTCHA_2_IMAGE_SIZE;
    const encoder = new GIFEncoder(CAPTCHA_2_IMAGE_SIZE, CAPTCHA_2_IMAGE_SIZE);

    const drawKittyAt = (
      canvas: Uint8Array,
      startX: number,
      startY: number,
      palette: string[]
    ) => {
      for (let x = 0; x < captchaColumns; ++x) {
        for (let y = 0; y < captchaRows; ++y) {
          let match = -1;
          let matchValue = 100;
          for (let p = 0; p < palette.length; ++p) {
            const d = chroma.deltaE(captchaData[y][x], palette[p]);
            if (d < matchValue) {
              matchValue = d;
              match = p;
            }
          }

          /*
          const index =
            (startY + y + Math.floor(Math.random() * 3) - 2) * columns +
            x +
            startX +
            Math.floor(Math.random() * 3) -
            2;*/

          const index = startX + x + (startY + y) * columns;
          //if (match !== SKIP || Math.random() < 0.5)
          canvas[index] = match;
          /* if (match === MATCH)*/
        }
      }
    };
    const canvas = new Uint8Array(9 * captchaColumns * captchaRows);

    const realPalette = generatePalette(16);
    const real = Math.floor(Math.random() * 9);
    for (let i = 0; i < 3; ++i) {
      for (let j = 0; j < 3; ++j) {
        if (i * 3 + j === real) console.log(i, j);
        drawKittyAt(
          canvas,
          i * 32,
          j * 32,
          i * 3 + j === real ? realPalette : generatePalette(16)
        );
      }
    }
    const stream = encoder.createReadStream();
    const c = createCanvas(CAPTCHA_2_IMAGE_SIZE, CAPTCHA_2_IMAGE_SIZE);
    const ctx = c.getContext("2d");
    encoder.start();
    ctx.putImageData(_drawCanvas(canvas, realPalette), 0, 0);

    encoder.addFrame(ctx as any);
    encoder.finish();

    return stream;
  };
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
      Math.round(Math.random() * 20)
    );
    const columnRotations = [...new Array(columns)].map(() =>
      Math.round(Math.random() * 20)
    );

    const t0 = new Date().getTime();
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

    const canvas = new Uint8Array(
      [...new Array(columns * rows)].map(() => SKIP)
    );

    const initialCanvas = canvas.slice();

    const drawKittyAt = (
      canvas: Uint8Array,
      startX: number,
      startY: number
    ) => {
      for (let x = 0; x < captchaColumns; ++x) {
        for (let y = 0; y < captchaRows; ++y) {
          let match = -1;
          let matchValue = 100;
          for (let p = 0; p < palette.length; ++p) {
            const d = chroma.distance(captchaData[y][x], palette[p]);
            if (d < matchValue) {
              matchValue = d;
              match = p;
            }
          }

          /*
          const index =
            (startY + y + Math.floor(Math.random() * 3) - 2) * columns +
            x +
            startX +
            Math.floor(Math.random() * 3) -
            2;*/

          const index = startX + x + (startY + y) * columns;
          //if (match !== SKIP || Math.random() < 0.5)
          canvas[index] = match;
          /* if (match === MATCH)*/
        }
      }
    };

    drawKittyAt(canvas, startX, startY);

    const t1 = new Date().getTime();
    for (let frame = finalFrame; frame > 0; --frame) {
      for (let column = columns; column >= 0; --column) {
        const rotation = -(columnRotations[column] - 10);
        if (frame % rotation === 0) {
          rotateColumn(canvas, columns, column, rotation === 0 ? -1 : rotation);
        }
      }

      for (let row = 0; row < rows; ++row) {
        const rotation = -(rowRotations[row] - 10);
        if (frame % rotation === 0) {
          rotateRow(canvas, columns, row, rotation === 0 ? -1 : rotation);
        }
      }
    }

    encoder.setDelay(1000 / 24);
    encoder.setRepeat(0);
    encoder.start();
    console.log("reconstruct");

    const c = createCanvas(columns, rows);
    const ctx = c.getContext("2d");

    const paletteCache = new Map<string, number[]>();

    const t2 = new Date().getTime();
    console.log(`t2: ${t2 - t1}`);

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
    };

    for (let frame = 1; frame < CAPTCHA_3_FRAME_COUNT; ++frame) {
      if (frame === 10) {
        //const c = canvas.slice()
        //drawKittyAt(c, 0,0);
        // drawCanvas(c)
      }
      for (let row = 0; row < rows; ++row) {
        const rotation = rowRotations[row] - 10;
        if (frame % rotation === 0) {
          rotateRow(canvas, columns, row, rotation);
        }
      }

      for (let column = columns; column >= 0; --column) {
        const rotation = columnRotations[column] - 10;
        if (frame % rotation === 0) {
          rotateColumn(canvas, columns, column, rotation);
        }
      }

      drawCanvas(canvas);
    }

    console.log(new Date().getTime() - t2);
    encoder.finish();

    console.log(finalFrame, new Date().getTime() - t0);

    // this data structure should allow us to track pixels
    // where is the pixel at frame Y that is going to be there at frame X
    // with predefined trajectories the whole thing can be much faster
    // the entire canvas is basicaly just going to be driven by the trajectory
    // well, still need to draw..
    const buildTrajectory = (
      columnRotations: number[],
      rowRotations: number[],
    ) => {
      console.log(columnRotations, rowRotations);
      const trajectory = new Map<number, number[]>();
      for (let frame = 1; frame < CAPTCHA_3_FRAME_COUNT; ++frame) {}
      console.log(trajectory);
    };

    buildTrajectory(columnRotations, rowRotations)

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

  const generateCaptcha2 = () => {
    const columns = CAPTCHA_2_IMAGE_SIZE;
    const rows = CAPTCHA_2_IMAGE_SIZE;
    const palette = generatePalette(4);
    const canvas = paint.generateDrawing(palette, columns, rows, 1);

    const finalFrame = 1; /*Math.floor(Math.random() * CAPTCHA_2_FRAME_COUNT) + 50;*/
    const startX = Math.floor(Math.random() * (columns - captchaColumns));
    const startY = Math.floor(Math.random() * (rows - captchaRows));
    const endX = startX + captchaColumns;
    const endY = startY + captchaRows;

    const rowRotations = [...new Array(rows)].map(() =>
      Math.round(Math.random() * 20)
    );
    const columnRotations = [...new Array(columns)].map(() =>
      Math.round(Math.random() * 20)
    );

    const t0 = new Date().getTime();

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

    for (let x = 0; x < captchaColumns; ++x) {
      for (let y = 0; y < captchaRows; ++y) {
        let match = -1;
        let matchValue = 100;
        for (let p = 0; p < palette.length; ++p) {
          const d = chroma.distance(captchaData[y][x], palette[p]);
          if (d < matchValue) {
            matchValue = d;
            match = p;
          }
        }

        /*
          const index =
            (y + Math.floor(Math.random() * 3)) * columns +
            x +
            Math.floor(Math.random() * 3);
            */

        const index = startX + x + (startY + y) * columns;
        // if (match !== SKIP || Math.random() < 0.5)
        canvas[index] = match;
        /* if (match === MATCH)*/
      }
    }

    for (let frame = finalFrame; frame > 1; --frame) {
      for (let column = columns; column >= 0; --column) {
        const rotation = -(columnRotations[column] - 10);
        if (frame % rotation === 0) {
          rotateColumn(
            canvas,
            CAPTCHA_2_IMAGE_SIZE,
            column,
            rotation === 0 ? -1 : rotation
          );
        }
      }

      for (let row = 0; row < rows; ++row) {
        const rotation = -(rowRotations[row] - 10);
        if (frame % rotation === 0) {
          rotateRow(
            canvas,
            CAPTCHA_2_IMAGE_SIZE,
            row,
            rotation === 0 ? -1 : rotation
          );
        }
      }
    }

    console.log(new Date().getTime() - t0);

    return Promise.resolve(
      new Uint8Array(
        Buffer.concat([
          new Uint8Array(columnRotations),
          new Uint8Array(rowRotations),
          canvas,
        ])
      )
    );
  };

  const generateCaptcha = (identity: string) => {
    const columns = CAPTCHA_IMAGE_SIZE;
    const rows = CAPTCHA_IMAGE_SIZE;
    const c = chroma.random();
    const c2 = chroma.random();
    const functionNames = ["brighten", "saturate", "darken", "desaturate"];
    const palette = [...new Array(16)].map(() =>
      (Math.random() < 0.5 ? c : (c2 as any))
        [functionNames[Math.floor(Math.random() * functionNames.length)]](
          Math.random() * 5
        )
        .hex()
    );
    const canvas = paint.generateDrawing(palette, columns, rows, 1);

    // TODO: consider security here, probably harmless but still might be better to do this random
    const challengeId = dataSlice(identity, 0, 4);

    const startX = Math.floor(Math.random() * (columns - captchaColumns));
    const startY = Math.floor(Math.random() * (rows - captchaRows));
    const endX = startX + captchaColumns;
    const endY = startY + captchaRows;

    let maxAverage = 0;
    let maxIndex = -1;
    // get the most distinguishable color from the palette
    for (let i = 0; i < palette.length; ++i) {
      let average = 0;
      for (let j = 0; j < palette.length; ++j) {
        if (i === j) continue;
        average += chroma.deltaE(palette[i], palette[j]);
      }

      if (average > maxAverage) {
        maxIndex = i;
        maxAverage = average;
      }
    }
    /*

    let MATCH = -1;
    let matchValue = 100;
    for (let p = 0; p < palette.length; ++p) {
      // finding the closest to the reference pixel
      // the outline should be different to the rest of the image
      const d = chroma.distance(
        captchaData[referencePixel[0]][referencePixel[1]],
        palette[p]
      );
      if (d < matchValue) {
        matchValue = d;
        MATCH = p;
      }
    }
    */

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

    for (let y = 0; y < rows; ++y) {
      for (let x = 0; x < columns; ++x) {
        if (y >= startY && y < endY && x >= startX && x < endX) {
          const cX = x - startX;
          const cY = y - startY;
          let match = -1;
          let matchValue = 100;
          for (let p = 0; p < palette.length; ++p) {
            const d = chroma.distance(captchaData[cY][cX], palette[p]);
            if (d < matchValue) {
              matchValue = d;
              match = p;
            }
          }

          const index =
            (y + Math.floor(Math.random() * 3)) * columns +
            x +
            Math.floor(Math.random() * 3);
          if (match !== SKIP || Math.random() < 0.5)
            /* if (match === MATCH)*/ canvas[index] = match;
        }
      }
    }

    const imageData = new Uint8ClampedArray(
      Array.from(canvas).flatMap((i) => {
        const result = chroma(palette[i]).rgba();
        result[3] = 255;

        return result;
      })
    );

    const targetImageData = new Uint8ClampedArray(
      captchaData
        .flatMap((i) => i)
        .flatMap((i) => {
          const result = i.rgba();
          result[3] = 255;

          return result;
        })
    );

    captchas.set(challengeId, {
      identity,
      tries: 0,
      solution: startY * CAPTCHA_IMAGE_SIZE + startX,
      imageData,
      targetImageData,
    });

    clock.in(CAPTCHA_TIMEOUT).then(() => captchas.delete(challengeId));

    return challengeId;
  };

  return {
    requestAccountCreation: async (identity: string) => {
      const challengeId = dataSlice(identity, 0, 4);

      if (captchas2.get(challengeId)) {
        captchas2.delete(challengeId);
      }

      if (await database.getUserByIdentity(identity))
        throw new BadRequestError("user already exists");

      return generateCaptcha5(identity);
    },
    createAccount: (address: string, email?: string, accountId?: string) => {
      // create user
      return database.insertUser(address);
    },
    updateAccount: () => {
      // verify captcha token
      // update account details
      console.log("creating account");
    },
    retrieveCaptchaChallenge: (challengeId: string) => {
      const challenge = captchas.get(challengeId);
      if (!challenge) throw new NotFoundError("challenge not found");

      const encoder = new GIFEncoder(CAPTCHA_IMAGE_SIZE, CAPTCHA_IMAGE_SIZE);
      const stream = encoder.createReadStream();
      const c = createCanvas(CAPTCHA_IMAGE_SIZE, CAPTCHA_IMAGE_SIZE);

      encoder.start();
      encoder.setQuality(10);
      const ctx = c.getContext("2d");

      ctx.putImageData(
        createImageData(
          challenge.imageData,
          CAPTCHA_IMAGE_SIZE,
          CAPTCHA_IMAGE_SIZE
        ),
        0,
        0
      );

      encoder.addFrame(ctx as any);

      encoder.finish();

      return stream;
    },

    retrieveCaptchaTarget: (challengeId: string) => {
      const challenge = captchas.get(challengeId);
      if (!challenge) throw new NotFoundError("challenge not found");

      const encoder = new GIFEncoder(captchaColumns, captchaRows);
      const stream = encoder.createReadStream();
      const c = createCanvas(captchaColumns, captchaRows);

      encoder.start();
      encoder.setQuality(10);
      const ctx = c.getContext("2d");

      ctx.putImageData(
        createImageData(challenge.targetImageData, captchaColumns, captchaRows),
        0,
        0
      );

      encoder.addFrame(ctx as any);

      encoder.finish();

      return stream;
    },
    /*
    solveCaptcha: (challengeId: string, solution: number) => {
      const captcha = captchas.get(challengeId);
      if (!captcha || captcha.tries > CAPTCHA_MAX_TRIES)
        throw new NotFoundError("captcha not found");

      if (
        getDistance(CAPTCHA_IMAGE_SIZE, captcha.solution, solution) >
        CAPTCHA_PROXIMITY
      ) {
        captcha.tries += 1;
        throw new BadRequestError("not close enough");
      }

      console.log(captcha.identity);

      return 200;
    },*/
    solveCaptcha: (challengeId: string, solution: number) => {
      const captcha = captchas2.get(challengeId);
      if (!captcha) throw new NotFoundError("captcha not found");
      console.log(solution, typeof solution);

      if (captcha.solution !== solution) {
        throw new BadRequestError("wrong picture selected");
      }

      captchas2.delete(challengeId);

      return database.insertUser(captcha.identity).then(() => true);
    },
    generateCaptcha2,
    generateCaptcha3,
    generateCaptcha4,
    generateCaptcha5,
  };
};
