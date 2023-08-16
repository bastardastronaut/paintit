import { existsSync } from "fs";
import cors from "cors";
import express, { Request, NextFunction, Response } from "express";
import bodyParser from "body-parser";
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
import path from "path";
import FileSystem from "./modules/filesystem";
import Contract from "./modules/contract";
import Database from "./modules/database";
import Paint from "./modules/paint";
import Clock from "./modules/clock";
import endpoints from "./endpoints";
import {
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  BadRequestError,
} from "./errors";
import spellCheck from "./spellCheck";
import palettes from "./palettes";
import monitorRequest, { requests, RequestType } from "./monitorRequest";
import Authorize, { authorizations } from "./authorize";
import generateCaptcha4 from "./modules/_generateCaptcha";

const PORT = process.env.PORT || 8081;
const BASE_URL = "/api";
const ec = new TextEncoder();
const dc = new TextDecoder();

enum HandoverState {
  AWAITING_REQUEST,
  AWAITING_RESPONSE,
}
const connections = new Map<string, Set<Response>>();
const handoverRequests = new Map<
  string,
  { state: HandoverState; currentResponse: Response }
>();
const blockedUsers = new Set<string>();

const notify = (hash: string, event: string, message: string) => {
  const responses = connections.get(hash);

  if (responses) {
    responses.forEach((response) => {
      response.write(`event: ${event}\ndata: ${message}\n\n`);
    });
  }
};

const PATH = process.env.APP_PATH || `${__dirname}/..`;
const FS_PATH = process.env.FILESYSTEM_PATH || `${PATH}/drawings`;
const database = new Database(FS_PATH, {
  onIterationProgress: (hash, iteration) =>
    notify(hash, "iteration-progress", iteration.toString()),
});
const masterWallet = new Wallet(
  process.env.ACCOUNT_ADDRESS ||
    "0dd740f1f726433da7a8dedb77c44b20ba7144245c8f2e138e000453398c9f8d"
);
const filesystem = new FileSystem(FS_PATH);
const clock = new Clock();
const paint = new Paint();
const authorize = Authorize(clock, database);
const contract = new Contract(masterWallet);

const invitationMap = new Map<
  string,
  { address: string; name: string; language: string }
>();

const mask = BigInt(process.env.MASK || "");

const w = new Wallet(
  "0fcdd042114636e258666cbc0f65d65d7a5fb78a88dc28f83726a73eb70f0d69"
);
w.signMessage(
  getBytes(
    concat([
      "0x6051d0E7a30BFF204c3ee96514E41Bb1E99A3A17",
      zeroPadValue(toBeArray(0), 4),
      zeroPadValue(ec.encode("rise.hun@gmail.com"), 32),
    ])
  )
).then((s) => console.log(s));
console.log(clock.authWindow);
console.log(w.address);
//0x6051d0E7a30BFF204c3ee96514E41Bb1E99A3A17
// 0x61f21a6e20f32e988d7f31608766bf631f5785b8a5bfb964747ddd74cfb43cda7b2c76528ebfc29dd8dda79f6c14ba1296408e062295333cf3278da01e99c9661c
const opened = [
  "0fcdd042114636e258666cbc0f65d65d7a5fb78a88dc28f83726a73eb70f0d69",
  "7da7f131a95d51b092e06d4c8ea324a67f505a37b5a3093baff9bfdc3331a940",
  "315663a0ecceabff7d6ca48f9be51a3b1ca542dbe3b5ad91c739eefb0a320f8f",
  "da006fe4a7d0cf2093c96aeab54268f05c2c59a190670930aebd90da2939e986",
  "9dc7e4a0549af764daae224f8e761434ce0e7bdbd24882f6ef967d35440239aa",
  "aa88e11a44e32e6b18af2b6cd1f6a7436575cc98babe41a38c814fa3f0fc2a97",
  "2ed0a4ec4ec5b88b8358b3562bc418b32d4904d83671408f3f45b5c3c8f825eb",
  "c1fe55bdb37846ae994320fecca14aabbc49dfe64fd1f5bcec1622cdf02cb9ac",
  "f0ac062efe0ff5388e3911f08acdad45b00d17ddbaf2841be7e876167ffc854a",
  "315663a0ecceabff7d6ca48f9be51a3b1ca542dbe3b5ad91c739eefb0a320f8f",
  "e685bbfc249b5f663ad1b2684f63dbe0cec6d5f12475e312debedd81bcc20bfc",
  "f313378f77cdf34b9888d826af3cce4c411c65369d7ef531ed595826730e3d17",
  "b8c1272fd7d17cec8c0b3bfffe28ad121d27c17354d850c64ff6d1d7fe179009",
  "bec95316ad0d3bcc28d3576ff99500fdc19e9ffb0dc64b6aa39986f4e3b1c3bd",
  "7ec8ba1c58e621a8cbf570f42392af2a3562442d8eee49a1f68319ccd5fd0b4e",
  "6ec9a917f89e97381f3cec03f3da87e63cc0967c65dd3cf24613b12dbf8c652b",
  "8f90aba0a72e31c99707cb4c154ee71d1a95585a47c90256a3b6afb2cc52eda5",
  "10716ae82b840b7c15643899a16835e4a1c96d75c16255028850d58bd87e1116",
  "177f81794b2e1dbf5f26b1e1e6f9cbc2c3d2e2570d3ca12295760365ad595c61",
  "89d1974cb5fcc2740cb2f84ece2b5e0c21c6a0deaa2eca14e2da4eefbbf3b36c",
];

if (mask) {
  const dc = new TextDecoder();
  const trim = (input: Uint8Array, seek = 0): Uint8Array => {
    if (input[seek] !== 0) return input.slice(seek);
    return trim(input, seek + 1);
  };

  filesystem
    .loadFile(
      "0xe1ec101432ae124588a9a948060128d29b8978d93d269a1cc21c91f22cdda81c"
    )
    .then((buffer) => {
      if (!buffer) throw new Error("invitations not found");
      const names = [];
      for (let i = 0; i < buffer.byteLength; i += 128) {
        const data = new Uint8Array(buffer.slice(i, i + 128));
        const asArray = getBytes(
          `0x${(BigInt(hexlify(data)) ^ mask).toString(16)}`
        );
        const seek = 56 - (128 - asArray.length);

        const name = dc.decode(asArray.slice(0, seek));
        const address = dc.decode(trim(asArray.slice(seek, seek + 68)));
        const language = dc.decode(trim(asArray.slice(seek + 68, seek + 72)));
        console.log(name);
        if (language === "hu") names.push(name);

        invitationMap.set(sha256(data).slice(2), {
          name,
          address,
          language,
        });
      }

      // console.log(names)

      for (const hash of opened) {
        //  console.log(invitationMap.get(hash));
      }
    });
  /*
  const inv = { address: "Dear Adam", language: "en", name: "Adam" };

  const data = concat([
    zeroPadValue(ec.encode(inv.name), 56),
    zeroPadValue(ec.encode(inv.address), 68),
    zeroPadValue(ec.encode(inv.language), 4),
  ]);

  const FINAL = `0x${(BigInt(data) ^ mask).toString(16)}`

  console.log(sha256(FINAL))
  // filesystem.saveFile(getBytes(FINAL))

    const asArray = getBytes(
      `0x${(BigInt(hexlify(FINAL)) ^ mask).toString(16)}`
    );

  const D =  `0x${(BigInt(data) ^ mask).toString(16)}`
  // console.log(D)

 
        const seek = 56 - (128 - asArray.length);

        const name = dc.decode(asArray.slice(0, seek));
        const address = dc.decode(trim(asArray.slice(seek, seek + 68)));
        const language = dc.decode(trim(asArray.slice(seek + 68, seek + 72)));

        console.log(name, address, language)*/
}

Promise.all([database.initialize(), contract.initialize()])
  .then(() => endpoints(database, filesystem, paint, clock, contract))
  .then(
    ({
      // publicly available endpoints
      getSessionCanvas,
      getSessionInitialCanvas,
      getSession,
      getSessionPaint,
      getSessionPromptByIdentity,
      getSessionActivity,
      getSessions,
      getSessionContributions,
      getSessionSnapshot,
      getSessionPrompts,
      getPixelHistory,
      getArchivedSessions,
      getSessionAnimation,
      getTransactions,

      // endpoints behind authorization
      // payload needs sanitization
      postAuthorizationSequence,
      registerAccount,
      postSessionPaint,
      postSessionPrompt,
      postUnlockMorePaint,
      requestWithdrawal,
      solveCaptcha,

      // captcha game endpoints
      captchaGameGenerate,
      captchaGameSolve,
    }) => {
      // canvas connections
      const app = express();
      const server = app.listen(PORT);
      const processError = (res: Response, e: Error) => {
        console.log(e);
        res.sendStatus(
          e instanceof NotFoundError
            ? 404
            : e instanceof BadRequestError
            ? 400
            : e instanceof UnauthorizedError
            ? 401
            : e instanceof TooManyRequestsError
            ? 429
            : 500
        );
      };

      app.use(monitorRequest(clock));
      app.use(cors());

      app.get(`${BASE_URL}/transactions/:identity`, (req, res) => {
        return getTransactions(req.params.identity)
          .then((transactions) => res.send(transactions))
          .catch((e) => processError(res, e));
      });

      app.get(`${BASE_URL}/palettes`, (req, res) => {
        res.send(palettes);
      });

      app.get(`${BASE_URL}/sessions`, (req, res) => {
        getSessions()
          .then((result) => res.send(result))
          .catch((e) => processError(res, e));
      });

      app.get(`${BASE_URL}/archived-sessions`, (req, res) => {
        getArchivedSessions(
          parseInt(req.query.limit as string) || 5,
          parseInt(req.query.offset as string) || 0
        )
          .then((result) => res.send(result))
          .catch((e) => processError(res, e));
      });

      app.get(
        `${BASE_URL}/sessions/:sessionHash/history/:positionIndex`,
        (req, res) => {
          getPixelHistory(
            req.params.sessionHash,
            parseInt(req.params.positionIndex)
          )
            .then((result) => res.send(result))
            .catch((e) => processError(res, e));
        }
      );

      app.get(`${BASE_URL}/sessions/:sessionHash`, (req, res) => {
        return getSession(req.params.sessionHash)
          .then((session) => res.send(session))
          .catch((e) => processError(res, e));
      });

      app.get(`${BASE_URL}/sessions/:sessionHash/canvas`, (req, res) => {
        return getSessionCanvas(req.params.sessionHash)
          .then((canvas) => res.end(canvas, "binary"))
          .catch((e) => processError(res, e));
      });

      app.get(
        `${BASE_URL}/sessions/:sessionHash/initial-canvas`,
        (req, res) => {
          return getSessionInitialCanvas(req.params.sessionHash)
            .then((canvas) => res.end(canvas, "binary"))
            .catch((e) => processError(res, e));
        }
      );

      app.get(`${BASE_URL}/sessions/:sessionHash/contributions`, (req, res) => {
        return getSessionContributions(req.params.sessionHash)
          .then((contributions) => res.send(contributions.slice(0, 10)))
          .catch((e) => processError(res, e));
      });

      app.get(`${BASE_URL}/sessions/:sessionHash/prompts`, (req, res) => {
        return getSessionPrompts(req.params.sessionHash)
          .then((prompts) => res.send(prompts.slice(0, 10)))
          .catch((e) => processError(res, e));
      });

      app.get(`${BASE_URL}/sessions/:sessionHash/image.gif`, (req, res) => {
        // TODO: set HTTP headers to not cache the image
        return getSessionSnapshot(req.params.sessionHash)
          .then((stream) => stream.pipe(res))
          .catch((e) => processError(res, e));
      });

      app.get(`${BASE_URL}/sessions/:sessionHash/animation.gif`, (req, res) => {
        // TODO: set HTTP headers to not cache the image
        return getSessionAnimation(req.params.sessionHash)
          .then((stream) => stream.pipe(res))
          .catch((e) => processError(res, e));
      });

      /*
    app.get(`${BASE_URL}/sessions/:sessionHash/history/:positionIndex`, (req, res) => {
      return getSessionPixelHistory(req.params.positionIndex)
        .then((session) => res.end(session, "binary"))
        .catch(() => res.sendStatus(400));
    });*/

      app.get(
        `${BASE_URL}/sessions/:sessionHash/activity/:identity`,
        (req, res) => {
          return getSessionActivity(req.params.sessionHash, req.params.identity)
            .then((result) => res.send(result))
            .catch((e) => processError(res, e));
        }
      );

      // returns all activity until revision
      app.get(`${BASE_URL}/sessions/:sessionHash/activity`, (req, res) => {
        return getSessionActivity(req.params.sessionHash)
          .then((result) => res.send(result))
          .catch((e) => processError(res, e));
      });

      app.get(
        `${BASE_URL}/sessions/:sessionHash/paint/:identity`,
        (req, res) => {
          return getSessionPaint(req.params.sessionHash, req.params.identity)
            .then((result) => res.send(result.toString()))
            .catch((e) => processError(res, e));
        }
      );

      /*
      app.get(`${BASE_URL}/generate-captcha-2`, (req, res) => {
        try {
          return res.send(encodeBase64(generateCaptcha3()));
        } catch (e) {
          return processError(res, e as Error);
        }
      });*/

      app.get(`${BASE_URL}/captcha.gif`, (req, res) => {
        try {
          return generateCaptcha4().pipe(res);
        } catch (e) {
          return processError(res, e as Error);
        }
      });

      app.post(
        `${BASE_URL}/account/:identity/withdrawals`,
        bodyParser.urlencoded({ limit: 192, extended: true }),
        authorize<{
          amount: number;
        }>((data) =>
          Promise.resolve(getBytes(zeroPadValue(toBeArray(data.amount), 32)))
        ),
        (req, res) => {
          return requestWithdrawal(
            req.body.signature,
            req.params.identity,
            req.body.amount
          )
            .then((result) => res.send(result))
            .catch((e) => processError(res, e));
        }
      );

      app.get(
        `${BASE_URL}/sessions/:sessionHash/prompt/:identity`,
        (req, res) => {
          return getSessionPromptByIdentity(
            req.params.sessionHash,
            req.params.identity
          )
            .then((result) => res.send(result))
            .catch((e) => processError(res, e));
        }
      );

      // TODO: watch for SQL injection!

      app.post(
        `${BASE_URL}/create-account`,
        bodyParser.urlencoded({ limit: 64, extended: true }),
        (req, res) =>
          registerAccount(req.body.account)
            .then((result) => res.send(encodeBase64(result)))
            .catch((e) => processError(res, e))
      );

      app.post(
        `${BASE_URL}/sessions/:sessionHash/unlock-paint/:identity`,
        bodyParser.urlencoded({ limit: 192, extended: true }),
        authorize(() => Promise.resolve(new Uint8Array([0, 0, 0, 10]))),
        (req, res) =>
          postUnlockMorePaint(req.params.sessionHash, req.params.identity)
            .then((result) => res.send(200))
            .catch((e) => processError(res, e))
      );

      app.post(
        `${BASE_URL}/sessions/:sessionHash/paint`,
        // we should use base64 eventually
        bodyParser.urlencoded({ limit: 384, extended: true }),
        (req, res) => {
          console.log(req.body);
          // TODO: need to sanitize input
          const set = connections.get(req.params.sessionHash);
          if (blockedUsers.has(req.body.identity)) return res.sendStatus(429);
          if (!set) return res.sendStatus(404);

          const positionIndex = parseInt(req.body.positionIndex);
          const colorIndex = parseInt(req.body.colorIndex);

          if (
            req.params.sessionHash.length !== 66 ||
            req.body.revision.length !== 66 ||
            req.body.identity.length !== 42 ||
            req.body.signature.length !== 132 ||
            isNaN(positionIndex) ||
            isNaN(colorIndex) ||
            colorIndex > 15
          )
            return res.sendStatus(400);

          postSessionPaint(
            req.params.sessionHash,
            req.body.identity,
            req.body.revision,
            req.body.signature,
            positionIndex,
            colorIndex
          )
            .then(({ userMetrics, updatedRevision, paintCost, paintLeft }) => {
              // timeout decreases for email verified users
              // further decreases for VIP users
              const verificationMultiplier = userMetrics.is_vip
                ? 0.5
                : userMetrics.is_verified
                ? 1
                : 3;

              // TODO: return ACK
              // a signature to the request
              // + time until next paint is allowed
              const userCount =
                connections.get(req.params.sessionHash)?.size || 1;
              const timeout =
                (verificationMultiplier *
                  (Math.ceil(userCount / 3) * 2500 * paintCost)) /
                100;

              blockedUsers.add(req.body.identity);
              setTimeout(() => blockedUsers.delete(req.body.identity), timeout);

              res.send({
                paintLeft,
                timeout,
              });

              notify(
                req.params.sessionHash,
                "canvas-update",
                encodeBase64(
                  concat([
                    new Uint8Array([colorIndex]),
                    zeroPadValue(toBeArray(positionIndex), 4),
                    updatedRevision,
                  ])
                )
              );
            })
            .catch((e) => processError(res, e));
        }
      );

      app.post(
        `${BASE_URL}/sessions/:sessionHash/prompt`,
        // we should use base64 eventually
        bodyParser.urlencoded({ limit: 256, extended: true }),
        (req, res) => {
          const { text, signature, identity } = req.body;
          if (blockedUsers.has(identity)) return res.sendStatus(429);
          // basically all POST endpoints need rate limiting
          // prompts should not be allowed to be changed only every 5-10 seconds max
          postSessionPrompt(req.params.sessionHash, identity, text, signature)
            .then(async (isComplete) => {
              res.sendStatus(200);

              if (isComplete) {
                notify(req.params.sessionHash, "iteration-progress", "1");
                return;
              }

              const message = JSON.stringify(
                await getSessionPrompts(req.params.sessionHash)
              );

              notify(req.params.sessionHash, "new-prompt", message);

              blockedUsers.add(identity);
              return clock.in(5);
            })
            .catch((e) => processError(res, e))
            .finally(() => {
              blockedUsers.delete(identity);
            });
        }
      );

      // TODO: this must be authorized
      // need to login via signature, only allow painting from users who have identified themselves
      // rate limiting will be based on this
      // # of users * second
      // 5 users need to wait for 5 seconds
      // 100 users need to wait for a minute and a half
      // email verified users will always take precedence
      // the problem is: how to kick someone out of the room in favor of email people?
      // we can simply limit it at 100
      // but give another 50/100 to email people
      // and another 100 for VIP people
      app.get(`${BASE_URL}/sessions/:sessionHash/updates`, (req, res) => {
        // need to have the correct auth window
        // console.log(req.params.signature);
        // need to have signature and verify user, do we ?
        if (connections.has(req.params.sessionHash)) {
          const set = connections.get(req.params.sessionHash) as Set<Response>;

          // this is the sensitive one, we need to reserve seats for verified accounts
          // non verified can only be ~50
          if (set.size > 100) return res.sendStatus(429);

          set.add(res);
        } else {
          connections.set(req.params.sessionHash, new Set([res]));
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        req.on("close", () => {
          res.end();
          const drawingConnections = connections.get(req.params.sessionHash);
          if (!drawingConnections) return;
          drawingConnections.delete(res);
          if (drawingConnections.size === 0)
            connections.delete(req.params.sessionHash);
        });
      });

      app.get(`${BASE_URL}/handover/:identity`, (req, res) => {
        let handoverRequest = handoverRequests.get(req.params.identity);
        const close = () => {
          res.end();
        };

        if (Object.keys(req.query).length > 0 && !handoverRequest)
          return res.sendStatus(404);

        if (handoverRequest && Object.keys(req.query).length === 0) {
          handoverRequest.currentResponse.write(
            `event: handover-close\ndata: null\n\n`
          );
          handoverRequest.currentResponse.end();
          handoverRequest = undefined;
        }

        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        if (handoverRequest) {
          handoverRequest.currentResponse.write(
            `event: handover-request\ndata: ${JSON.stringify(req.query)}\n\n`
          );
          handoverRequest.currentResponse.end();
          handoverRequests.set(req.params.identity, {
            state: HandoverState.AWAITING_RESPONSE,
            currentResponse: res,
          });
        } else {
          handoverRequests.set(req.params.identity, {
            state: HandoverState.AWAITING_REQUEST,
            currentResponse: res,
          });
        }

        clock.in(360).then(close);

        req.on("close", close);
      });

      // -- Authorization --

      app.post(
        `${BASE_URL}/account/:identity/authorization`,
        bodyParser.urlencoded({ limit: 192, extended: true }),
        (req, res) => {
          try {
            const sequence = postAuthorizationSequence(
              req.params.identity,
              req.body.signature
            );

            authorizations.set(req.params.identity, sequence);

            res.send(sequence.toString());
          } catch (e) {
            console.log(e);
            res.sendStatus(400);
          }
        }
      );

      // sets the email of the account
      // - generates verification code that expires in 15 minutes
      // - needs to be signed
      // - simple signature check
      // - first 66 * 2 bytes of message is just signature

      app.post(
        `${BASE_URL}/account/:identity/email/set`,
        bodyParser.urlencoded({ limit: 192, extended: true }),
        authorize<{
          email: string;
        }>((data) =>
          Promise.resolve(getBytes(zeroPadValue(ec.encode(data.email), 32)))
        ),
        (req, res) => {
          console.log(req.params.identity);
          // send email
          res.sendStatus(200);
        }
      );

      // checks against
      app.post(
        `${BASE_URL}/account/:identity/email/verify`,
        bodyParser.urlencoded({ limit: 192, extended: true }),
        (req, res) =>
          registerAccount(req.body.account)
            .then((result) => res.send(encodeBase64(result)))
            .catch((e) => processError(res, e))
      );

      app.post(
        `${BASE_URL}/handover/:identity`,
        bodyParser.urlencoded({ limit: 192, extended: true }),
        (req, res) => {
          const handoverRequest = handoverRequests.get(req.params.identity);
          if (
            !handoverRequest ||
            handoverRequest.state !== HandoverState.AWAITING_RESPONSE
          )
            return res.sendStatus(404);

          handoverRequest.currentResponse.write(
            `event: handover-response\ndata: ${req.body.payload}\n\n`
          );
          handoverRequest.currentResponse.end();
          handoverRequests.delete(req.params.identity);

          res.sendStatus(200);
        }
      );

      app.get(`${BASE_URL}/status`, (req, res) => {
        try {
          return res.send({
            read: Object.fromEntries(
              requests.get(RequestType.Read) as Map<string, number>
            ),
            mutate: Object.fromEntries(
              requests.get(RequestType.Mutate) as Map<string, number>
            ),
            create: Object.fromEntries(
              requests.get(RequestType.Create) as Map<string, number>
            ),
          });
        } catch (e) {
          return processError(res, e as Error);
        }
      });

      // -- WEDDING INVITATION MODULE

      app.post(
        `${BASE_URL}/invitations/:invitationId`,
        bodyParser.urlencoded({ limit: 256, extended: true }),
        (req, res) => {
          if (!new Set(invitationMap.keys()).has(req.params.invitationId))
            return res.sendStatus(404);

          database
            .insertInvitationResponse(req.params.invitationId, {
              rsvp: req.body.rsvp === "accept" ? 1 : 0,
              attendees: req.body.attendees,
              mealPreferences: req.body.mealPreferences,
              songRequest: req.body.songRequest,
              comment: req.body.comment,
            })
            .then(() => res.sendStatus(200))
            .catch((e) => {
              console.log(e);
              res.sendStatus(400);
            });
        }
      );

      app.get(`${BASE_URL}/invitations/`, (req, res) => {
        database
          .getInvitationResponses()
          .then((responses) => res.send(responses));
      });

      app.get(`${BASE_URL}/invitations/:invitationId`, (req, res) => {
        if (!new Set(invitationMap.keys()).has(req.params.invitationId))
          return res.sendStatus(404);
        database
          .getInvitationResponse(req.params.invitationId)
          .then((response) =>
            response ? res.send(response) : res.sendStatus(404)
          );
      });

      app.get(`${BASE_URL}/verify-invitation/:invitationId`, (req, res) => {
        if (!new Set(invitationMap.keys()).has(req.params.invitationId))
          return res.sendStatus(404);

        return res.send(invitationMap.get(req.params.invitationId));
      });

      // -- Captchas --

      app.get(`${BASE_URL}/captcha/:identity/play`, (req, res) => {
        try {
          return res.send(
            encodeBase64(captchaGameGenerate(req.params.identity))
          );
        } catch (e) {
          return processError(res, e as Error);
        }
      });

      app.post(
        `${BASE_URL}/captcha/:identity/solve`,
        bodyParser.urlencoded({ limit: 192, extended: true }),
        (req, res) =>
          captchaGameSolve(
            req.params.identity,
            parseInt(req.body.solution),
            req.body.signature
          )
            .then((result) => res.send(result))
            .catch((e) => processError(res, e))
      );

      app.post(
        `${BASE_URL}/captcha/:challengeId`,
        bodyParser.urlencoded({ limit: 128, extended: true }),
        (req, res) => {
          return solveCaptcha(
            req.params.challengeId,
            parseInt(req.body.solution)
          )
            .then((result) => res.send(200))
            .catch((e) => processError(res, e));
        }
      );

      app.use(express.static(`${PATH}/public`));
      app.get("*", (req, res) =>
        res.sendFile(
          path.resolve("client", "build", `${PATH}/public/index.html`)
        )
      );

      console.log(`up & running on port ${PORT}`);
    }
  );

// only fill these in if you want to support identity generation
// remaining endpoints
// update profile
// - email
// - profile picture
// - link account

// - request drawing
// - request
// - post action
// - request actions
// - load profile
// - load history
// - load drawing proof (canvas, history, metadata, all)
// - also, once the drawing is completed (iteration > log2 palette) remove from database and create file
// - gallery, load all files.
// - signup for changes on canvas

/*
const paintLength = 72;
const parallel = 3;
const iterationLengths = [12, 24, 36];
const sessions = [48, 24, 0];
let done = 0;

const MULTIPLIERS = [1, 5, 15, 50];

const DISTRIBUTION = [0.5, 0.3, 0.15, 0.05];

const COMMON_REWARDS = 100;

let supply = 0;

for (let h = 0; h < 144 * 52; ++h) {
  for (let i = 0; i < parallel; ++i) {
    if (++sessions[i] === paintLength) {
      supply += 500;

      done++;
      sessions.shift();
      sessions.push(0);
    }
  }
}

console.log(done, supply);
*/
