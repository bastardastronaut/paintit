import chroma from 'chroma-js'
export const getDistance = (
  columns: number,
  positionIndex1: number,
  positionIndex2: number
): number => {
  const x1 = positionIndex1 % columns;
  const x2 = positionIndex2 % columns;

  const y1 = Math.floor(positionIndex1 / columns);
  const y2 = Math.floor(positionIndex2 / columns);

  const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

  return distance;
};

export const generatePalette = (paletteSize = 16) => {
    
    const c = chroma.random();
    const c2 = chroma.random();
    const functionNames = ["brighten", "saturate", "darken", "desaturate"];
    return [...new Array(paletteSize)].map(() =>
      (Math.random() < 0.5 ? c : (c2 as any))
        [functionNames[Math.floor(Math.random() * functionNames.length)]](
          Math.random() * 5
        )
        .hex()
    );
}
