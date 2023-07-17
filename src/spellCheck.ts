import SpellChecker from "simple-spellchecker";
import fs from "fs";

const readFileLines = (filename: string) =>
  fs.readFileSync(filename).toString().split("\n");

const FORBIDDEN_COMBINATIONS = readFileLines(`${__dirname}/badwords.txt`);

const getDictionary = (dict: string) =>
  new Promise((resolve, reject) => {
    SpellChecker.getDictionary("en-GB", function (err: any, dictionary: any) {
      if (err) return reject(err);

      resolve(dictionary);
    });
  });

export default (promptText: string): Promise<boolean> =>
  Promise.all([getDictionary("en-GB"), getDictionary("en-US")]).then(
    ([ukDict, usDict]: any[]) => {
      for (const f of FORBIDDEN_COMBINATIONS) {
        if (!f) continue
        if (promptText.toLowerCase().includes(f)) return false;
      }

      for (const word of promptText.split(" ")) {
        if (!ukDict.spellCheck(word) && !usDict.spellCheck(word)) return false;
      }

      return true;
    }
  );
