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
import { NotFoundError, BadRequestError } from "./errors";
import spellCheck from "./spellCheck";
import palettes from "./palettes";

const PORT = process.env.PORT || 8081;
const BASE_URL = "/api";

const connections = new Map<string, Set<Response>>();
const blockedUsers = new Set<string>();

const notify = (hash: string, event: string, message: string) => {
  const responses = connections.get(hash);

  if (responses) {
    responses.forEach((response) => {
      response.write(`event: ${event}\ndata: ${message}\n\n`);
    });
  }
};

const database = new Database({
  onIterationProgress: (hash, iteration) =>
    notify(hash, "iteration-progress", iteration.toString()),
});

const PATH = `${__dirname}/${process.env.APP_PATH || ".."}`;
const filesystem = new FileSystem(PATH);
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
      registerAccount,
      postSessionPaint,
      postSessionPrompt,
      requestWithdrawal,
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
            : 500
        );
      };

      app.use((req, res, next) => {
        console.log(req.url);
        next();
      });

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
        bodyParser.urlencoded({ limit: 128, extended: true }),
        (req, res) =>
          registerAccount(req.body.account, "")
            .then(() => res.sendStatus(201))
            .catch((e) => processError(res, e))
      );

      app.post(
        `${BASE_URL}/sessions/:sessionHash/paint`,
        // we should use base64 eventually
        bodyParser.urlencoded({ limit: 384, extended: true }),
        (req, res) => {
          if (blockedUsers.has(req.body.identity)) return res.sendStatus(429);
          const positionIndex = parseInt(req.body.positionIndex);
          const colorIndex = parseInt(req.body.colorIndex);

          postSessionPaint(
            req.params.sessionHash,
            req.body.identity,
            req.body.revision,
            req.body.signature,
            positionIndex,
            colorIndex
          )
            .then(({ updatedRevision, paintCost, paintLeft }) => {
              // TODO: return ACK
              // a signature to the request
              // + time until next paint is allowed
              const userCount =
                connections.get(req.params.sessionHash)?.size || 1;
              const timeout =
                (Math.ceil(userCount / 3) * 2500 * paintCost) / 100;

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
            .then(async (newPrompt) => {
              res.sendStatus(200);
              if (newPrompt) {
                notify(
                  req.params.sessionHash,
                  "new-session-prompt",
                  newPrompt.prompt
                );

                if (newPrompt.isComplete) {
                  notify(req.params.sessionHash, "iteration-progress", "1");
                }

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
      app.get(`${BASE_URL}/sessions/:sessionHash/updates`, (req, res) => {
        if (connections.has(req.params.sessionHash)) {
          connections.get(req.params.sessionHash)!.add(res);
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
