import { dataSlice } from "ethers";
import Database, { CaptchaAttemptOutcome } from "./database";
import Paint from "./paint";
import Clock from "./clock";
import chroma from "chroma-js";
import GIFEncoder from "gifencoder";
import { NotFoundError, BadRequestError } from "../errors";
import { createCanvas, createImageData } from "canvas";
import { generatePalette, getDistance } from "./utils";
import generateCaptcha from "./generateCaptcha";

import palettes from "../palettes";

const CAPTCHA_TIMEOUT = 3600;
// instead of this, we can just take the most popular color and turn it into noise

const captchaChallenges = new Map<
  string,
  {
    solution: number;
    filename: string;
  }
>();
const captchas = new Map<
  string,
  {
    identity: string;
    solution: {
      paletteIndex: number;
      randomPoints: Map<number, number>;
    };
    challenge: ArrayBuffer;
  }
>();

const handoverRequests = new Map<string, number>();

export default (clock: Clock, database: Database, paint: Paint) => {
  return {
    requestAccountCreation: async (identity: string) => {
      const challengeId = dataSlice(identity, 0, 4);

      if (captchas.get(challengeId)) {
        captchas.delete(challengeId);
      }

      if (await database.getUserByIdentity(identity))
        throw new BadRequestError("user already exists");

      const { solution, challenge } = generateCaptcha();

      console.log(solution);

      captchas.set(challengeId, {
        identity,
        solution,
        challenge: challenge.buffer,
      });

      clock.in(CAPTCHA_TIMEOUT).then(() => captchas.delete(challengeId));

      return null;
    },
    createAccount: (
      address: string,
      username: string,
      email?: string,
      accountId?: string
    ) => {
      // create user
      return database.insertUsername(address, username);
    },

    updateUsername: (identity: string, username: string) => {
      return database.getUserByIdentity(identity).then((existingUser) => {
        if (existingUser) return database.setUsername(identity, username);
        return database.insertUsername(identity, username);
      });
    },
    solveCaptcha: (challengeId: string, solution: number) => {
      const captcha = captchas.get(challengeId);
      if (!captcha) throw new NotFoundError("captcha not found");
      console.log(solution, typeof solution);

      if (captcha.solution.paletteIndex !== solution) {
        throw new BadRequestError("wrong picture selected");
      }

      // TODO: also evrify points

      captchas.delete(challengeId);

      return database.insertUser(captcha.identity).then(() => true);
    },

    generateCaptchaAttempt: (identity: string) => {
      if (captchaChallenges.get(identity)) {
        captchaChallenges.delete(identity);
      }

      const { solution, challenge, filename } = generateCaptcha(9, 0, 0);

      captchaChallenges.set(identity, {
        filename,
        solution: solution.paletteIndex,
      });

      clock.in(CAPTCHA_TIMEOUT).then(() => captchaChallenges.delete(identity));

      // we can also send back difficulty as first byte

      return challenge;
    },

    solveCaptchaGame: (identity: string, solution: number) => {
      const captcha = captchaChallenges.get(identity);
      if (typeof captcha === "undefined")
        throw new NotFoundError("captcha not found");

      captchas.delete(identity);

      const isSuccess = captcha.solution === solution;

      return database
        .insertCaptchaAttempt(
          captcha.filename,
          identity,
          CaptchaAttemptOutcome[isSuccess ? "SUCCESS" : "FAILURE"]
        )
        .then(() => database.loadCaptchaAttempts(captcha.filename))
        .then((attempts) => ({
          successRatio:
            Math.round(
              (100 *
                attempts.filter(
                  ({ outcome }) => outcome === CaptchaAttemptOutcome.SUCCESS
                ).length) /
                attempts.length
            ) / 100,
          solution: captcha.solution,
        }));
    },

    /*
     * the process: a new device is ready to authenticate
     * from the users perspective
     * */
    requestHandover: (
      identity: string,
      payload: number,
      signature: string
    ) => {},

    respondToHandover: (identity: string, response: string) => {},

    loadUsernames: () => database.getUsernames(),
  };
};
