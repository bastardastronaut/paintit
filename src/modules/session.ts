import {
  sha256,
  zeroPadValue,
  concat,
  verifyMessage,
  toBeArray,
  getBytes,
} from "ethers";
import chroma from "chroma-js";
import Database, { Activity, Session } from "./database";
import Clock from "./clock";
import FileSystem from "./filesystem";
import Paint from "./paint";
import palettes from "../palettes/";
import { NotFoundError, BadRequestError } from "../errors";
import GIFEncoder from "gifencoder";
import { createCanvas, createImageData } from "canvas";
import spellCheck from "../spellCheck";

const ITERATION_LENGTH = 3600;
const ITERATION_COUNT = 5;
const ITERATION_PAINT = 1000;
const BATCH_FRAMERATE_SECONDS = 10;
const PROMPT_WORD_LENGTH = 5;

/*
const DIMENSIONS = [
  [128, 128],
  [128, 96],
  [96, 128],
  [256, 256],
  [256, 192],
  [192, 256],
];*/

// for POC
//const DIMENSIONS = [[16, 16]];
const DIMENSIONS = [
  [16, 16],
  [32, 24],
  [64, 48],
  [24, 32],
  [48, 64],
];

// randomize all things
// palette
// aspect ratio (2:3, 3:2, 5:4)

// this'll be only for free lobbies
// for premium ones, paint will be generated after participation is confirmed
const DEFAULT_PAINT = 1000;

type RevisionCacheEntry = {
  revision: string;
  positionIndex: number;
};

const getColorDiff = (paletteIndex: number, color1: number, color2: number) =>
  chroma.deltaE(palettes[paletteIndex][color1], palettes[paletteIndex][color2]);

const getPaintCost = (
  paletteIndex: number,
  historyLength: number,
  colorFrom: number,
  colorTo: number
) => {
  return Math.floor(
    Math.pow(1.1, historyLength) *
      getColorDiff(paletteIndex, colorFrom, colorTo)
  );
};

const getDistance = (
  columns: number,
  positionIndex1: number,
  positionIndex2: number
): number => {
  const x1 = positionIndex1 % columns;
  const x2 = positionIndex2 % columns;

  const y1 = Math.floor(positionIndex1 / columns);
  const y2 = Math.floor(positionIndex2 / columns);

  const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));

  return distance;
};

export default async (
  database: Database,
  paint: Paint,
  filesystem: FileSystem,
  clock: Clock
) => {
  const lockedSessions = new Set<string>();
  const revisionCaches = new Map<string, RevisionCacheEntry[]>();

  // store actions for last 5 revisions
  // accept actions from users if changes are significantly far away
  // distance at least 5
  // TODO: also needs to be session hash based

  //const scheduleDrawingGeneration = async (): Promise<number> => {
  const generateDrawing = async (): Promise<void> => {
    const [columns, rows] =
      DIMENSIONS[Math.floor(Math.random() * DIMENSIONS.length)];
    const paletteIndex = Math.floor(Math.random() * palettes.length);
    const canvas = paint.generateDrawing(
      palettes[paletteIndex],
      columns,
      rows,
      1
    );

    const hash = sha256(canvas);

    await Promise.all([
      database.insertSession(hash, columns, rows, paletteIndex),
      filesystem.saveFile(canvas),
    ]);

    /*
    const session = await database.getSessionByHash(hash);

    return session!.created_at;

    // so actuallly
    // prompt doesn't actually count as iteration in that it is not fixed length
    // rather, it takes time foom the first iteration
    // 36, 36
    /*
    return clock
      .at(session!.created_at + ITERATION_LENGTH)
      .then(() => {
        return database.progressSession(hash, 1);
      })
      .then(() => {
        return database.getSessionByHash(hash);
      })
      .then((_session) => {
        if (!_session) throw new Error("not found");
        return clock.at(_session.iteration_started_at + ITERATION_LENGTH);
      })
      .then(() => {
        // currently this is the end of the drawing
        return database.progressSession(hash, 2);
      })
      .then(() => scheduleDrawingGeneration());
      */
  };

  const loadSession = (sessionHash: string) => {
    return database.getSessionByHash(sessionHash).then((s) => {
      if (!s) throw new Error("session loading failed");

      return {
        paletteIndex: s.palette_index,
        columns: s.columns,
        rows: s.rows,
        iteration: s.current_iteration,
        sessionType: s.session_type,
        iterationStartedAt: s.iteration_started_at,
        iterationEndsAt: s.iteration_started_at + ITERATION_LENGTH,
        revision: s.revision,
        prompt: s.prompt,
        maxIterations: ITERATION_COUNT,
      };
    });
  };

  const loadSessionCanvas = (sessionHash: string) =>
    loadSession(sessionHash)
      .then((s) => {
        return filesystem.loadFile(s.revision);
      })
      .then((canvas) => {
        if (!canvas) throw new Error("session loading failed");

        return canvas;
      });

  const loadSessionContributions = (sessionHash: string) => {
    return Promise.all([
      loadSession(sessionHash),
      filesystem.loadFile(sessionHash),
      loadSessionCanvas(sessionHash),
      database.getActivityByDrawing(sessionHash),
    ]).then(([s, canvas, _finalCanvas, activityLog]) => {
      const finalCanvas = new Uint8Array(_finalCanvas);
      const canvasArray = new Uint8Array(canvas);
      const contributions = new Map<string, number>();
      const historyLengths = new Map<number, number>();

      for (const activity of activityLog) {
        contributions.set(
          activity.identity,
          ((50 -
            getColorDiff(
              s.paletteIndex,
              activity.color_index,
              finalCanvas[activity.position_index]
            )) *
            getPaintCost(
              s.paletteIndex,
              historyLengths.get(activity.position_index) || 0,
              activity.color_index,
              canvasArray[activity.position_index]
            )) /
            50 +
            (contributions.get(activity.identity) || 0)
        );

        canvasArray[activity.position_index] = activity.color_index;
      }

      return Array.from(contributions.entries()).sort(([, a], [, b]) =>
        a > b ? -1 : 1
      );
    });
  };

  const finishSession = async (s: Session) => {
    console.log(`finishing session ${s.hash}`)
    // need to calculate contributions and create transactions
    const contributions = await loadSessionContributions(s.hash);
    return database
      .progressSession(s.hash, ITERATION_COUNT)
      .then(() =>
        database.insertTransactions(
          contributions.map(([identity, contribution]) => ({
            identity,
            amount: Math.floor(contribution / 100),
            message: s.hash,
          }))
        )
      )
      .then(() => null);
  };

  const currentSessions = await database.getActiveSessions();

  const progressSession = (session: Session): Promise<null> => {
    if (session.current_iteration === ITERATION_COUNT - 1) {
      return finishSession(session);
    }

    return Promise.all([
      database.progressSession(session.hash, session.current_iteration + 1),
      database.resetParticipantsPaint(session.hash, ITERATION_PAINT),
    ])
      .then(() => database.getSessionByHash(session.hash))
      .then((_session) =>
        _session
          ? clock
              .at(_session.iteration_started_at + ITERATION_LENGTH)
              .then(() => progressSession(_session))
          : null
      );
  };

  for (const s of currentSessions) {
    if (s.current_iteration > 0 && s.current_iteration < ITERATION_COUNT) {
      clock
        .at(s!.iteration_started_at + ITERATION_LENGTH)
        .then(() => progressSession(s));
    }
  }

  if (currentSessions.length === 0) {
    await generateDrawing();
  }

  return {
    loadSession,
    loadSessionCanvas,
    loadSessionContributions,
    loadSessionInitialCanvas: (sessionHash: string) =>
      filesystem.loadFile(sessionHash),
    loadSessionPrompts: (sessionHash: string) => {
      return database.getSessionPrompts(sessionHash).then((results) => {
        const parsedResults = new Map<
          string,
          { text: string; votes: number }
        >();

        for (const prompt of results) {
          const token = prompt.text.toLowerCase();
          const previousValue = parsedResults.get(token);

          if (previousValue) {
            parsedResults.set(token, {
              text:
                previousValue.votes > prompt.votes
                  ? previousValue.text
                  : prompt.text,
              votes: previousValue.votes + prompt.votes,
            });
          } else {
            parsedResults.set(token, prompt);
          }
        }

        return Array.from(parsedResults.values()).sort((a, b) =>
          a.votes > b.votes ? -1 : 1
        );
      });
    },
    loadPixelHistory: (sessionHash: string, positionIndex: number) =>
      database.getPixelHistory(sessionHash, positionIndex).then((activity) =>
        activity.map(({ position_index, color_index }) => ({
          positionIndex: position_index,
          colorIndex: color_index,
        }))
      ),
    loadArchivedSessions: (limit?: number, offset?: number) =>
      database.getArchivedSessions(limit, offset).then((sessions) =>
        sessions.map(
          ({
            rows,
            columns,
            hash,
            palette_index,
            session_type,
            prompt,
            created_at,
          }) => ({
            hash,
            rows,
            columns,
            prompt,
            paletteIndex: palette_index,
            sessionType: session_type,
            createdAt: created_at,
            maxIterations: ITERATION_COUNT,
          })
        )
      ),
    loadSessions: () =>
      database.getActiveSessions().then((sessions) =>
        sessions.map(
          ({
            rows,
            columns,
            hash,
            palette_index,
            session_type,
            iteration_started_at,
            current_iteration,
            prompt,
            revision,
          }) => ({
            revision,
            hash,
            rows,
            columns,
            iteration: current_iteration,
            prompt,
            paletteIndex: palette_index,
            sessionType: session_type,
            iterationStartedAt: iteration_started_at,
            iterationEndsAt: iteration_started_at + ITERATION_LENGTH,
            maxIterations: ITERATION_COUNT,
          })
        )
      ),

    loadSessionGIF: (sessionHash: string) => {
      return Promise.all([
        loadSession(sessionHash),
        loadSessionCanvas(sessionHash),
      ]).then(([s, canvas]) => {
        const encoder = new GIFEncoder(s.columns, s.rows);
        const stream = encoder.createReadStream();
        const c = createCanvas(s.columns, s.rows);
        const imageData = createImageData(
          new Uint8ClampedArray(
            Array.from(canvas).flatMap((i) => {
              const result = chroma(palettes[s.paletteIndex][i]).rgba();
              result[3] = 255;

              return result;
            })
          ),
          s.columns,
          s.rows
        );

        encoder.start();
        encoder.setQuality(10);
        const ctx = c.getContext("2d");

        ctx.putImageData(imageData, 0, 0);

        encoder.addFrame(ctx as any);

        encoder.finish();

        return stream;
      });
    },

    loadSessionAnimGIF: (sessionHash: string) => {
      return Promise.all([
        loadSession(sessionHash),
        filesystem.loadFile(sessionHash),
        loadSessionCanvas(sessionHash),
        database.getActivityByDrawing(sessionHash),
      ]).then(([s, canvas, _finalCanvas, activityLog]) => {
        const finalCanvas = new Uint8Array(_finalCanvas);
        const encoder = new GIFEncoder(s.columns, s.rows);
        const stream = encoder.createReadStream();
        const c = createCanvas(s.columns, s.rows);
        const canvasArray = new Uint8Array(canvas);
        const canvasToImageData = (_canvas: Uint8Array) =>
          createImageData(
            new Uint8ClampedArray(
              Array.from(_canvas).flatMap((i) => {
                const result = chroma(palettes[s.paletteIndex][i]).rgba();
                result[3] = 255;

                return result;
              })
            ),
            s.columns,
            s.rows
          );

        encoder.start();
        encoder.setRepeat(0);
        const ctx = c.getContext("2d");

        ctx.putImageData(canvasToImageData(canvasArray), 0, 0);
        encoder.addFrame(ctx as any);

        let activityStartedAt = 0;

        for (const activity of activityLog) {
          if (activityStartedAt === 0) {
            activityStartedAt = activity.created_at;
          }
          if (
            activity.created_at - activityStartedAt >
            BATCH_FRAMERATE_SECONDS
          ) {
            ctx.putImageData(canvasToImageData(canvasArray), 0, 0);
            encoder.addFrame(ctx as any);
            activityStartedAt = 0;
          }

          canvasArray[activity.position_index] = activity.color_index;
        }
        // the value of a painting can be the amount of meaningful contributions
        // it will determine the amount of ART sent out anyway
        //
        // 3 aspects of value
        // meaningfully spent paint
        // somehow need to include distance from noise
        // user perception of prompt accuracy
        // user perception of artistic value

        encoder.finish();

        return stream;
      });
    },

    // TODO: we will also need to send over full history but without revision for replayability
    loadSessionActivity: (sessionHash: string, identity?: string) => {
      // this might pull MBs of data from the database
      // consider applying a revision <> activity cache
      return database
        .getActivityByDrawing(sessionHash, identity)
        .then((activity) =>
          identity
            ? activity.map((a) => ({
                revision: a.revision,
                positionIndex: a.position_index,
                colorIndex: a.color_index,
              }))
            : activity.map((a) => ({
                positionIndex: a.position_index,
                colorIndex: a.color_index,
              }))
        );
    },

    loadSessionPaint: (sessionHash: string, identity: string) => {
      return database
        .getUserSessionPaint(sessionHash, identity)
        .then((result) => result?.paint || DEFAULT_PAINT);
    },

    loadSessionPromptByIdentity: (sessionHash: string, identity: string) => {
      return database
        .getUserSessionPrompt(sessionHash, identity)
        .then((result) => result?.text || "");
    },

    newPrompt: async (
      sessionHash: string,
      identity: string,
      promptWord: string,
      signature: string
    ) => {
      const text = promptWord.trim();
      const words = text.split(" ");
      const excluded = ["the", "a", "an"];
      if (
        words.length > 2 ||
        (words.length === 2 && !excluded.includes(words[0].toLowerCase())) ||
        !(await spellCheck(text))
      )
        throw new BadRequestError("invalid prompt");

      // TODO: also verify signature, not needed for now as we don't reward participation in prompts

      // 1.: check if prompt is valid (must be one word / the, a)

      lockedSessions.add(sessionHash);

      try {
        // load current session
        const session = await database.getSessionByHash(sessionHash);
        if (!session) throw new BadRequestError();

        const r = session.rows * session.columns;
        const consensusRequirement = Math.round(
          (Math.log(r) / Math.log(2)) * (r / 16384)
        );

        if (session.current_iteration > 0)
          throw new BadRequestError("session prompt completed");

        const matchingPrompts = await database.getMatchingPrompts(
          sessionHash,
          text
        );

        // TODO: check against whether match has already the same prompt?
        if (
          matchingPrompts &&
          matchingPrompts.matchCount >= consensusRequirement - 1
        ) {
          // proceed with completion

          const newPrompt = session.prompt ? `${session.prompt} ${text}` : text;

          const isComplete =
            session.prompt
              .split(" ")
              .filter((s) => !excluded.includes(s.toLowerCase())).length ===
            PROMPT_WORD_LENGTH - 1;

          await database.updateSessionPrompt(
            sessionHash,
            newPrompt,
            isComplete
          );

          if (isComplete) {
            // MVP policy
            const [s] = await Promise.all([
              database.getSessionByHash(sessionHash),
              generateDrawing(),
            ]);

            clock.at(s!.iteration_started_at + ITERATION_LENGTH).then(() => {
              // this is basically finish in MVP
              return progressSession(s as Session);
            });
          }

          // need to wait for the previous to finish successfully

          await database.deleteSessionPrompts(sessionHash);

          return { prompt: newPrompt, isComplete };
        }

        await database.insertSessionPrompt(
          sessionHash,
          identity,
          text,
          signature
        );

        return null;
      } finally {
        lockedSessions.delete(sessionHash);
      }

      // 2.: check if it reaches consensus
      // 3.: if it does, update prompt on session, remove all user prompts from database
      // 4.: if prompt length has reached length requirement, drawing commences
      // return database.insertSessionPrompt(hash, identity, prompt, signature);
    },

    paint: async (
      sessionHash: string,
      identity: string,
      revision: string,
      signature: string,
      positionIndex: number,
      colorIndex: number
    ) => {
      // if first iteration check if it's first 16 colors.
      if (colorIndex > 15) {
        throw new BadRequestError("color not allowed");
      }

      const activity = await database.getActivityByDrawing(
        sessionHash,
        identity
      );

      activity.push({
        identity,
        revision,
        color_index: colorIndex,
        position_index: positionIndex,
        created_at: clock.now, // TBD
      });

      if (
        verifyMessage(
          getBytes(
            sha256(
              activity.reduce(
                (acc, a) =>
                  concat([
                    acc,
                    new Uint8Array([a.color_index]),
                    zeroPadValue(toBeArray(a.position_index), 4),
                    a.revision,
                  ]),
                "0x"
              )
            )
          ),
          signature
        ) !== identity
      )
        throw new BadRequestError("signature verification failed");

      const waitForUnlock = async (backoffTime: number) => {
        // TODO: doesn't seem to be working at the moment
        if (!lockedSessions.has(sessionHash)) {
          return;
        }
        console.log("locked");
        await new Promise((r) => setTimeout(r, backoffTime));
        waitForUnlock(backoffTime * 2);
      };

      await waitForUnlock(100);

      let lockedAt = new Date().getTime();

      lockedSessions.add(sessionHash);

      try {
        let paintLeft = (
          await database.getUserSessionPaint(sessionHash, identity)
        )?.paint;
        let isNewUser = false;
        if (paintLeft === undefined) {
          isNewUser = true;
          paintLeft = DEFAULT_PAINT;
        }

        const session = await database.getSessionByHash(sessionHash);
        if (!session) throw new NotFoundError("session not found");
        if (
          session.current_iteration === 0 ||
          session.current_iteration === ITERATION_COUNT
        )
          throw new NotFoundError("session not in correct state");
        const canvas = await filesystem.loadFile(session.revision);
        if (!canvas) throw new NotFoundError("canvas not found");

        // check for eligibility
        // is the session in correct state?
        // need to know palette,
        // remember, signature = all previous actions
        const newCanvas = new Uint8Array(canvas.byteLength);

        newCanvas.set(canvas);

        const history = await database.getPixelHistory(
          sessionHash,
          positionIndex
        );

        // this can obviously get more complicated
        const paintCost = getPaintCost(
          session.palette_index,
          history.length,
          colorIndex,
          newCanvas[positionIndex]
        );

        if (paintCost === 0)
          throw new BadRequestError("already the same color");
        if (paintCost > paintLeft) throw new BadRequestError("paint spent");

        const revisionCache = revisionCaches.get(sessionHash) || [];

        // storing snapshot on file system
        // whenever new revision applied, old gets removed:set b
        if (revision !== session.revision) {
          let matchIndex = revisionCache.findIndex(
            (e) => e.revision === revision
          );
          const match = revisionCache[matchIndex];
          let isDrawSpaceViolated = false;

          while (!isDrawSpaceViolated && matchIndex < revisionCache.length) {
            isDrawSpaceViolated =
              getDistance(
                session.columns,
                revisionCache[matchIndex++].positionIndex,
                positionIndex
              ) < 3;
          }

          if (!match || isDrawSpaceViolated) {
            throw new BadRequestError("revision mismatch");
          }
        }

        newCanvas[positionIndex] = colorIndex;
        paintLeft -= paintCost;

        const updatedRevision = sha256(newCanvas);

        await database.insertActivity(
          sessionHash,
          revision,
          identity,
          positionIndex,
          colorIndex
        );

        return Promise.all([
          filesystem.saveFile(newCanvas),
          database.updateRevision(sessionHash, updatedRevision),
          isNewUser
            ? database.generateUserPaint(sessionHash, identity, paintLeft)
            : database.updateUserPaint(sessionHash, identity, paintLeft),
          isNewUser
            ? database.insertSignature(sessionHash, identity, signature)
            : database.updateSignature(sessionHash, identity, signature),
        ]).then(() => {
          // if any error, we need to rollback
          if (revisionCache.length > 5) revisionCache.shift();

          if (revisionCache.length > 0)
            filesystem.removeFile(revisionCache.slice(-1)[0].revision);

          revisionCache.push({ revision: updatedRevision, positionIndex });

          revisionCaches.set(sessionHash, revisionCache);

          return updatedRevision;
        });
      } finally {
        console.log(`unlocked after ${new Date().getTime() - lockedAt}`);
        lockedSessions.delete(sessionHash);
      }

      // actually, no we are not changing this
      // the result is initial canvas + actions
    },
  };
};
