import {
  randomBytes,
  Signature,
  encodeBase64,
  zeroPadValue,
  toBeArray,
  getBytes,
  concat,
  toNumber,
  verifyMessage,
  hexlify,
  Wallet,
  sha256,
} from "ethers";
import Database from "./modules/database";
import FileSystem from "./modules/filesystem";
import Clock from "./modules/clock";
import Contract from "./modules/contract";
import Paint from "./modules/paint";
import { NotFoundError, UnauthorizedError, BadRequestError } from "./errors";
import Account from "./modules/account";
import Session from "./modules/session";
import Transactions from "./modules/transactions";

export default async (
  database: Database,
  filesystem: FileSystem,
  paint: Paint,
  clock: Clock,
  contract: Contract
) => {
  const account = await Account(clock, database, paint);
  const session = await Session(database, paint, filesystem, clock);
  const transactions = await Transactions(database, contract);

  const expiredSignatures = new Set<string>();

  // actually this should be a middleware
  return {
    // always consider replay attacks in these
    // it's probably safest to always only allow one request/account
    // upon getAccount we can return a token
    // (generate 1000 hashes and move up the chain)
    // accounts are stored in a map of {number, root}
    // once through new token is generated.
    // any POST must adhere to token rule
    // every post will return the next token
    postVoteOnQuality: (
      hash: string,
      identity: string,
      signature: string,
      value: number
    ) => {
      // requires tokens in wallet
    },

    postSessionPaint: (
      hash: string,
      identity: string,
      revision: string,
      signature: string,
      positionIndex: number,
      colorIndex: number
    ) =>
      session.paint(
        hash,
        identity,
        revision,
        signature,
        positionIndex,
        colorIndex
      ),

    postSessionPrompt: (
      hash: string,
      identity: string,
      prompt: string,
      signature: string
      // TODO: need to make sure that latest prompt is registered
      // revision: string,
    ) => session.processNewPrompt(hash, identity, prompt, signature),

    postUnlockMorePaint: (sessionHash: string, identity: string) =>
      transactions
        .spendArt(identity, 10, sessionHash)
        .then(() => session.unlockMorePaint(sessionHash, identity)),

    getSessions: () => session.loadSessions(),
    getArchivedSessions: (limit?: number, offset?: number) =>
      session.loadArchivedSessions(limit, offset),
    getSession: (hash: string) => session.loadSession(hash),
    getSessionContributions: (hash: string) =>
      session.loadSessionContributions(hash),
    getPixelHistory: (hash: string, positionIndex: number) =>
      session.loadPixelHistory(hash, positionIndex),
    getSessionCanvas: (hash: string) => session.loadSessionCanvas(hash),
    getSessionInitialCanvas: (hash: string) =>
      session.loadSessionInitialCanvas(hash),
    getSessionPrompts: (hash: string) => session.loadSessionPrompts(hash),
    getSessionSnapshot: (hash: string) => session.loadSessionGIF(hash),
    getSessionAnimation: (hash: string) => session.loadSessionAnimGIF(hash),
    getSessionActivity: (hash: string, identity?: string) =>
      session.loadSessionActivity(hash, identity),
    getSessionPaint: (hash: string, identity: string) =>
      session.loadSessionPaint(hash, identity),
    getSessionPromptByIdentity: (hash: string, identity: string) =>
      session.loadSessionPromptByIdentity(hash, identity),
    getGallery: (page?: number, pageSize?: number) => {},

    getTransactions: (identity: string) =>
      transactions.loadTransactions(identity),

    // token should defend against replay
    registerAccount: (identity: string) =>
      account.requestAccountCreation(identity),

    linkAccount: (
      identity: string,
      account: string,
      token: string,
      accountSignature: string,
      identitySignature: string
    ) => {},

    updateAccount: (
      identity: string,
      changedFields: string,
      token: string,
      signature: string
    ) => {},

    requestWithdrawal: async (
      signature: string,
      identity: string,
      _amount: string
    ) => {
      if (expiredSignatures.has(signature))
        throw new BadRequestError("signature expired");

      const amount = parseInt(_amount);

      expiredSignatures.add(signature);

      clock.atAuthWindow(clock.authWindow + 1).then(() => {
        expiredSignatures.delete(signature);
      });

      return transactions.requestWithdrawal(identity, amount);
    },

    getAccount: (hash: string, signature: string, timestamp: number) => {},

    postAuthorizationSequence: (identity: string, signature: string) => {
      if (
        identity !==
        verifyMessage(
          getBytes(
            concat([identity, zeroPadValue(toBeArray(clock.authWindow), 4)])
          ),
          signature
        )
      ) {
        throw new UnauthorizedError();
      }

      return toNumber(randomBytes(4));
    },

    solveCaptcha: (challengeId: string, solution: number) =>
      account.solveCaptcha(challengeId, solution),

    captchaGameGenerate: account.generateCaptchaAttempt,
    captchaGameSolve: (
      identity: string,
      solution: number,
      signature: string
    ) => {
      // this is obviously not good enough, need to know challenge id
      // susceptible to replay attacks
      if (
        identity !==
        verifyMessage(concat([identity, new Uint8Array([solution])]), signature)
      ) {
        throw new BadRequestError("invalid signature");
      }

      return account.solveCaptchaGame(identity, solution);
    },
  };
};
