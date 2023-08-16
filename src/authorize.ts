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

export const authorizations = new Map<string, number>();

const Authorize =
  (clock: Clock, database: Database) =>
  <T>(getMessage: (body: T) => Promise<Uint8Array>) =>
  (req: Request, res: Response, next: NextFunction) => {
    getMessage(req.body)
      .then((_message) => {
        const identity = req.params.identity || req.body.identity;
        const authorization = authorizations.get(identity) ?? 0;

        const message = getBytes(
          concat([zeroPadValue(toBeArray(authorization), 4), _message])
        );

        try {
          if (verifyMessage(message, req.body.signature) !== identity)
            return res.sendStatus(401);
        } catch (e) {
          if (e instanceof TypeError) {
            return res.sendStatus(400);
          }
          throw e;
        }

        next();

        // TODO: consider overflow
        authorizations.set(identity, authorization + 1);

        /*
      database
        .setUserAuthorization(identity, authorization + 1)
        .then(() => next());*/
      })
      .catch(() => res.sendStatus(400));
  };

export default Authorize;
