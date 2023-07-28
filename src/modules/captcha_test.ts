const rotateColumn = (
  canvas: number[],
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
  canvas: number[],
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
      nextPixel = nextIndex % columns === 0 ? tmp : canvas[nextIndex];
    } else {
      nextPixel = column === 0 ? canvas[(row + 1) * columns - 1] : tmp;
      tmp = canvas[index];
    }
    canvas[index] = nextPixel;
  }
};

const generateTrajectory = (
  columns: number,
  rows: number,
  frameCount: number,
  rotationFrequency = 5
) => {
  const canvas = [...new Array(rows * columns)].map((_, i) => i);
  const animationFrames = [canvas];

  const rowRotations = [...new Array(rows)].map(
    () => Math.round(Math.random() * rotationFrequency * 2) - rotationFrequency
  );
  const columnRotations = [...new Array(columns)].map(
    () => Math.round(Math.random() * 2 * rotationFrequency) - rotationFrequency
  );

  for (let f = 1; f < frameCount; ++f) {
    const c = [...animationFrames[f - 1]];
    for (let column = 0; column < columns; ++column) {
      if (f % columnRotations[column] === 0) {
        rotateColumn(c, columns, column, columnRotations[column]);
      }
    }
    for (let row = 0; row < rows; ++row) {
      if (f % rowRotations[row] === 0) {
        rotateRow(c, rows, row, rowRotations[row]);
      }
    }
    animationFrames.push(c);
  }

  const trajectories: number[][] = [];

  for (let i = 0; i < rows * columns; ++i) {
    trajectories[i] = [];
    for (let f = 0; f < frameCount; ++f) {
      trajectories[i][f] = animationFrames[f].findIndex((n) => n === i);
    }
  }
  return trajectories;
};

export default generateTrajectory;
