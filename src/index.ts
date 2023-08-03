import { existsSync } from "fs";
import cors from "cors";
import express, { Response } from "express";
import bodyParser from "body-parser";
import {
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
import { NotFoundError, TooManyRequestsError, BadRequestError } from "./errors";
import spellCheck from "./spellCheck";
import palettes from "./palettes";
import monitorRequest, { requests, RequestType } from "./monitorRequest";
import generateCaptcha4 from "./modules/_generateCaptcha";

const PORT = process.env.PORT || 8081;
const BASE_URL = "/api";

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
const FS_PATH = process.env.FILESYSTEM_PATH || `${PATH}/drawings`
const database = new Database(FS_PATH, {
  onIterationProgress: (hash, iteration) =>
    notify(hash, "iteration-progress", iteration.toString()),
});
const filesystem = new FileSystem(FS_PATH);
const clock = new Clock();
const paint = new Paint();
const contract = new Contract(
  new Wallet(
    process.env.ACCOUNT_ADDRESS ||
      "0dd740f1f726433da7a8dedb77c44b20ba7144245c8f2e138e000453398c9f8d"
  )
);

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
      registerAccount,
      postSessionPaint,
      postSessionPrompt,
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
        console.log(
          e,
          e instanceof BadRequestError,
          e instanceof NotFoundError
        );
        res.sendStatus(
          e instanceof NotFoundError
            ? 404
            : e instanceof BadRequestError
            ? 400
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

      app.get(`${BASE_URL}/palettes`, (req, res) => {
        res.send(palettes);
      });

      app.get(`${BASE_URL}/sessions`, (req, res) => {
        getSessions()
          .then((result) => res.send(result))
          .catch((e) => processError(res, e));
      });

      app.get(`${BASE_URL}/archived-sessions`, (req, res) => {
        // TODO: watch for SQL injection!
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

      app.get(`${BASE_URL}/withdrawals/:signature/:amount`, (req, res) => {
        return requestWithdrawal(`0x${req.params.signature}`, req.params.amount)
          .then((result) => res.send(result))
          .catch((e) => processError(res, e));
      });

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

      app.post(
        `${BASE_URL}/create-account`,
        bodyParser.urlencoded({ limit: 64, extended: true }),
        (req, res) =>
          registerAccount(req.body.account)
            .then((result) => res.send(encodeBase64(result)))
            .catch((e) => processError(res, e))
      );

      app.post(
        `${BASE_URL}/sessions/:sessionHash/paint`,
        // we should use base64 eventually
        bodyParser.urlencoded({ limit: 384, extended: true }),
        (req, res) => {
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
            })
            .catch((e) => processError(res, e));
        }
      );

      // TODO: this must be authorized
      // need to login via signature, only allow painting from users who have identified themselves
      // rate limiting will be based on this
      // # of users * second
      // 5 users need to wait for 5 seconds
      // 100 users need to wait for a minute and a half
      app.get(`${BASE_URL}/sessions/:sessionHash/updates/`, (req, res) => {
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
          handoverRequest.currentResponse.write(`event: handover-close\ndata: null\n\n`);
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

      app.get(`${BASE_URL}/captcha/:identity/play`, (req, res) => {
        try {
          return res.send(
            encodeBase64(captchaGameGenerate(req.params.identity))
          );
        } catch (e) {
          return processError(res, e as Error);
        }
      });

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
