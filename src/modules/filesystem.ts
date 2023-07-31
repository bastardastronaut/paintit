import { writeFile, readFile, unlink } from "node:fs/promises";
import { sha256 } from "ethers";

// this may very well come back into play, revisions shouldn't be stored as files really
const _files = new Map<string, Uint8Array>();

export default class FileSystem {
  private path;

  constructor(path: string) {
    this.path = `${path}/drawings`;
  }

  saveFile(canvas: Uint8Array) {
    return Promise.resolve(_files.set(sha256(canvas), canvas));
    // console.log(`saving ${this.path}/${sha256(canvas)}`);
    // return writeFile(`${this.path}/${sha256(canvas)}`, canvas);
  }

  loadFile(hash: string) {
    return Promise.resolve(_files.get(hash) as Uint8Array);
    // console.log(`loading ${this.path}/${hash}`);
    //return readFile(`${this.path}/${hash}`);
  }

  removeFile(hash: string) {
    return Promise.resolve(_files.delete(hash));
    //return unlink(`${this.path}/${hash}`);
  }
}
