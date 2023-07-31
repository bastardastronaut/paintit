import {
  sha256,
  zeroPadValue,
  concat,
  verifyMessage,
  toBeArray,
  getBytes,
  randomBytes,
} from "ethers";
import { readFileSync } from "fs";
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
import { getDistance } from "./utils";

const ITERATION_LENGTH = 900;
const ITERATION_COUNT = 5;
const ITERATION_PAINT = 2500; // TBD: will depend on stage contribution and verification status
const DEFAULT_PAINT = 200;
const DEFAULT_PAINT_EMAIL_VERIFIED = 2000;
const DEFAULT_PAINT_VIP = 3000;
const INVITATION_BONUS = 100;
const BATCH_FRAMERATE_SECONDS = 10;
const DEFAULT_PROMPT_WORD_LENGTH = 5;
const EXCLUDED = ["the", "a", "an"];

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
  [
    [32, 24],
    [24, 32],
  ],

  [
    [64, 48],
    [48, 64],
    [48, 72],
  ],

  [
    [96, 72],
    [72, 96],
    [72, 108],
  ],

  [
    [128, 96],
    [96, 128],
    [96, 144],
  ],

  [
    [192, 144],
    [144, 192],
    [144, 216],
  ],

  [
    [256, 192],
    [192, 256],
    [192, 288],
  ],

  [
    [384, 288],
    [288, 384],
    [288, 432],
  ],

  [
    [512, 384],
    [384, 512],
    [384, 576],
  ],
];

// randomize all things
// palette
// aspect ratio (2:3, 3:2, 5:4)

// this'll be only for free lobbies
// for premium ones, paint will be generated after participation is confirmed

type RevisionCacheEntry = {
  revision: string;
  positionIndex: number;
};

const getSize = (columns: number, rows: number) => {
  for (let size = 0; size < DIMENSIONS.length; ++size) {
    for (const dimensions of DIMENSIONS[size]) {
      if (dimensions[0] === columns && dimensions[1] === rows) return size;
    }
  }

  return 0;
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
  const generateDrawing = async (size: number): Promise<void> => {
    const [columns, rows] =
      DIMENSIONS[size][Math.floor(Math.random() * DIMENSIONS[size].length)];
    const paletteIndex = Math.floor(Math.random() * palettes.length);
    const canvas = paint.generateDrawing(
      palettes[paletteIndex],
      columns,
      rows,
      1
    );

    const hash = sha256(canvas);

    const promptSize = 3 + Math.floor(Math.random() * 5);

    await Promise.all([
      database.insertSession(hash, columns, rows, paletteIndex, promptSize),
      filesystem.saveFile(canvas),
    ]);
  };

  const loadSession = (sessionHash: string) => {
    return database.getSessionByHash(sessionHash).then((s) => {
      if (!s) throw new Error("session loading failed");
      const promptSize = s.prompt_word_length || DEFAULT_PROMPT_WORD_LENGTH;

      return {
        paletteIndex: s.palette_index,
        columns: s.columns,
        rows: s.rows,
        iteration: s.current_iteration,
        sessionType: s.session_type,
        iterationStartedAt: s.iteration_started_at,
        iterationEndsAt: s.iteration_started_at + ITERATION_LENGTH,
        revision: s.revision,
        promptSize,
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

      // also consider initial canvas in the calculation

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
    const revisionCache = revisionCaches.get(s.hash) || [];
    if (revisionCache) {
      revisionCache
        .slice(0, -1)
        .forEach((r) => filesystem.removeFile(r.revision));
      revisionCaches.delete(s.hash);
    }
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
      .then(() => database.getPromptSessions())
      .then((sessions) => {
        if (sessions.length > 1) return null;
        const nextSize = getSize(s.columns, s.rows) - 2;
        return generateDrawing(nextSize > 0 ? nextSize : 0);
      })
      .then(() => null);
  };

  const currentSessions = await database.getActiveSessions();

  const progressSession = (session: Session): Promise<null> => {
    if (session.current_iteration === ITERATION_COUNT - 1) {
      return finishSession(session);
    }

    return Promise.all([
      database.progressSession(session.hash, session.current_iteration + 1),
      database.resetParticipantsPaint(session.hash),
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

  const loadSessionPaint = (sessionHash: string, identity: string) =>
    database.getUserSessionPaint(sessionHash, identity).then((result) =>
      result === null
        ? database
            .getUserMetrics(identity)
            .then(([userStatus, invitations]) => {
              if (!userStatus) return DEFAULT_PAINT;

              const basePaint = userStatus.is_vip
                ? DEFAULT_PAINT_VIP
                : userStatus.is_verified
                ? DEFAULT_PAINT_EMAIL_VERIFIED
                : DEFAULT_PAINT;

              return (
                basePaint +
                (invitations?.invitationCount || 0) * INVITATION_BONUS
              );
            })
        : result.paint
    );

  for (const s of currentSessions) {
    if (s.current_iteration > 0 && s.current_iteration < ITERATION_COUNT) {
      clock
        .at(s!.iteration_started_at + ITERATION_LENGTH)
        .then(() => progressSession(s));
    }
  }

  if (currentSessions.length === 0) {
    await generateDrawing(0);
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
        activity.map(({ identity, position_index, color_index }) => ({
          identity,
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
        database.getActivityByDrawing(sessionHash),
      ]).then(([s, canvas, activityLog]) => {
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

    loadSessionPaint,

    loadSessionPromptByIdentity: (sessionHash: string, identity: string) => {
      return database
        .getUserSessionPrompt(sessionHash, identity)
        .then((result) => result?.text || "");
    },

    processNewPrompt: async (
      sessionHash: string,
      identity: string,
      _prompt: string,
      signature: string
    ) => {
      const prompt = _prompt.trim();
      const words = prompt.split(" ");
      if (
        words.length > 5 ||
        prompt.length > 32 ||
        !(await spellCheck(prompt))
      ) {
        throw new BadRequestError("invalid prompt");
      }

      const session = await loadSession(sessionHash);

      if (session.iteration > 0)
        throw new BadRequestError("session prompt completed");

      lockedSessions.add(sessionHash);

      try {
        const r = session.rows * session.columns;
        const consensusRequirement = Math.round(
          (Math.log(r) / Math.log(2)) * (r / 16384)
        );

        const matchingPrompts = await database.getMatchingPrompts(
          sessionHash,
          prompt
        );

        const isComplete =
          (matchingPrompts?.matchCount || 0) >= consensusRequirement - 1;

        const duration = clock.now - session.iterationStartedAt;
        const currentSize = getSize(session.columns, session.rows);

        const nextSize =
          duration < ITERATION_LENGTH
            ? currentSize + 1
            : duration > 2 * ITERATION_LENGTH
            ? currentSize - 1
            : currentSize;

        if (isComplete) {
          await database.updateSessionPrompt(sessionHash, prompt, isComplete);
          await database.deleteSessionPrompts(sessionHash);
          const promptSessions = await database.getPromptSessions();

          if (promptSessions.length > 0) return true;

          const [s] = await Promise.all([
            database.getSessionByHash(sessionHash),
            generateDrawing(
              nextSize >= DIMENSIONS.length
                ? DIMENSIONS.length - 1
                : nextSize < 0
                ? 0
                : nextSize
            ),
          ]);

          clock
            .at(s!.iteration_started_at + ITERATION_LENGTH)
            .then(() => progressSession(s as Session));

          return true;
        }

        await database.insertSessionPrompt(
          sessionHash,
          identity,
          prompt,
          signature
        );

        return false;
      } finally {
        lockedSessions.delete(sessionHash);
      }
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
        let [[userMetrics], session, existingSignature, paintLeft] =
          await Promise.all([
            database.getUserMetrics(identity),
            database.getSessionByHash(sessionHash),
            database.getSessionSignature(sessionHash, identity),
            loadSessionPaint(sessionHash, identity),
          ]);

        let isNewUser = !!existingSignature;

        if (!session) throw new NotFoundError("session not found");
        if (
          session.current_iteration === 0 ||
          session.current_iteration === ITERATION_COUNT
        )
          throw new NotFoundError("session not in correct state");
        const canvas = await filesystem.loadFile(session.revision);
        if (!canvas) throw new NotFoundError("canvas not found");

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

          if (!match) throw new BadRequestError("revision mismatch");

          while (!isDrawSpaceViolated && ++matchIndex < revisionCache.length) {
            isDrawSpaceViolated =
              getDistance(
                session.columns,
                revisionCache[matchIndex].positionIndex,
                positionIndex
              ) < 3;
          }

          if (isDrawSpaceViolated) {
            throw new BadRequestError("draw space violation");
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

        console.log();
        console.log(isNewUser);
        console.log();

        console.log(paintLeft);

        return Promise.all([
          filesystem.saveFile(newCanvas),
          database.updateRevision(sessionHash, updatedRevision),
          database.updateUserPaint(sessionHash, identity, paintLeft),
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

          return {
            userMetrics: userMetrics || { is_verified: false, is_vip: false },
            updatedRevision,
            paintCost,
            paintLeft,
          };
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
