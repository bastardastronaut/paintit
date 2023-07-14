import SpellChecker from "simple-spellchecker";

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
      for (const word of promptText.split(" ")) {
        if (!ukDict.spellCheck(word) && !usDict.spellCheck(word)) return false;
      }

      return true;
    }
  );
