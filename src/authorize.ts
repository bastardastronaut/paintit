import express, { Request, NextFunction, Response } from "express";
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

import Clock from "./modules/clock";
import Database from "./modules/database";

const Authorize =
  (clock: Clock, database: Database) =>
  <T>(getMessage: (body: T) => Promise<Uint8Array>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.all([
      database.getUserAuthorization(req.params.identity || req.body.identity),
      getMessage(req.body),
    ]).then(([result, _message]) => {
      const authorization = result?.sequence ?? 0;

      const message = getBytes(
        concat([
          req.params.identity,
          zeroPadValue(toBeArray(authorization), 4),
          _message,
        ])
      );

      try {
        if (verifyMessage(message, req.body.signature) !== req.params.identity)
          return res.sendStatus(401);
      } catch (e) {
        if (e instanceof TypeError) {
          return res.sendStatus(400);
        }
        throw e;
      }

      next();

      /*
      database
        .setUserAuthorization(identity, authorization + 1)
        .then(() => next());*/
    });
  };

export default Authorize;
