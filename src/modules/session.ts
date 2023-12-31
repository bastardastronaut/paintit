import {
  sha256,
  zeroPadValue,
  concat,
  verifyMessage,
  toBeArray,
  getBytes,
  toNumber,
  hexlify,
  randomBytes,
} from "ethers";
import { readFileSync } from "fs";
import chroma from "chroma-js";
import Database, { Activity, Session } from "./database";
import Clock from "./clock";
import FileSystem from "./filesystem";
import Paint from "./paint";
import Contract from "./contract";
import { NotFoundError, BadRequestError } from "../errors";
import GIFEncoder from "gifencoder";
import { createCanvas, createImageData } from "canvas";
import spellCheck from "../spellCheck";
import { generatePalette2, getDistance } from "./utils";
import {
  PALETTE_SIZE,
  ITERATION_LENGTH,
  ITERATION_COUNT,
  ITERATION_PAINT,
  INVITATION_BONUS,
  DEFAULT_PAINT,
  UNLOCKED_PAINT,
  DEFAULT_PAINT_EMAIL_VERIFIED,
  CONSENSUS_MULTIPLIER,
} from "../consts";

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
  /*
  [
    [32, 24],
    [24, 32],
  ],
*/
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

const findClosestColors = (
  palette: string[],
  colorIndex: number,
  n: number
) => {
  const currentColor = palette[colorIndex];
  return palette
    .map((c, i) => ({ i, c }))
    .sort((a, b) =>
      chroma.deltaE(a.c, currentColor) > chroma.deltaE(b.c, currentColor)
        ? 1
        : -1
    )
    .slice(0, n)
    .map((a) => a.i);
};

const findOriginalColorIndex = (
  currentColorIndex: number,
  iteration: number,
  activity: Activity[]
) => {
  if (
    activity.length === 0 ||
    activity[activity.length - 1].iteration < iteration
  )
    return currentColorIndex;

  let i = activity.length - 1;
  while (i >= 0) {
    if (activity[i].iteration < iteration) return activity[i].color_index;
    i -= 1;
  }

  return null;
};

const getPixelHistory = (
  initialColor: number,
  currentIteration: number,
  activity: Activity[]
) => {
  let lastIteration = 0;
  let lastColorIndex = 0;
  const colorHistory = [];
  for (const a of [
    { color_index: initialColor, iteration: 0 },
    ...(activity || []),
    { color_index: -1, iteration: 101 },
  ]) {
    if (a.iteration === lastIteration) {
      lastColorIndex = a.color_index;
      continue;
    }

    const pixel = document.createElement("li");
    if (lastIteration !== currentIteration) {
      pixel.style.animation = "none";
      colorHistory.push(lastColorIndex);
    }

    if (a.color_index !== -1) {
      lastIteration = a.iteration;
      lastColorIndex = a.color_index;
    }
  }

  return colorHistory;
};

const getPaintCost = (
  historyLength: number,
  colorFrom: number,
  colorTo: number
) => {
  return (historyLength + 1) * 25;
  /*
  return Math.floor(
    Math.pow(1.1, historyLength) *
      getColorDiff(paletteIndex, colorFrom, colorTo)
  );*/
};

export default async (
  database: Database,
  paint: Paint,
  contract: Contract,
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
    // const paletteIndex = Math.floor(Math.random() * palettes.length);
    const paletteIndex = 0;
    const palette = generatePalette2(PALETTE_SIZE);
    const canvas = paint.generateDrawing(palette, columns, rows, 1);

    const hash = sha256(canvas);

    await Promise.all([
      database.insertSession(hash, columns, rows, palette, ITERATION_COUNT),
      filesystem.saveFile(canvas),
    ]);
  };

  const loadSession = (sessionHash: string) => {
    return database.getSessionByHash(sessionHash).then((s) => {
      if (!s) throw new Error("session loading failed");

      return {
        palette: s.palette.split("|"),
        columns: s.columns,
        rows: s.rows,
        iteration: s.current_iteration,
        sessionType: s.session_type,
        iterationStartedAt: s.iteration_started_at,
        iterationEndsAt: s.iteration_started_at + ITERATION_LENGTH,
        revision: s.revision,
        participants: s.participants,
        txHash: s.tx_hash,
        prompt: s.prompt,
        createdAt: s.created_at,
        maxIterations: s.max_iterations,
      };
    });
  };

  const loadSessionCanvas = (sessionHash: string) =>
    loadSession(sessionHash)
      .then((s) => {
        // not so simple
        return filesystem.loadFile(s.revision);
      })
      .then((canvas) => {
        if (!canvas) throw new Error("session loading failed");

        return canvas;
      });

  // loads activity based on whether the session has finished or not
  const loadSessionActivity = (
    sessionHash: string,
    identity?: string
  ): Promise<
    Array<{
      createdAt?: number;
      identity?: string;
      revision?: string;
      positionIndex: number;
      colorIndex: number;
    }>
  > =>
    loadSession(sessionHash).then((session) =>
      session.iteration === session.maxIterations
        ? filesystem.loadFile(sessionHash).then((art) => {
            if (!art) return [];
            const metadata = new Uint8Array(art.slice(0, 75));
            const rows = toNumber(metadata.slice(64, 66));
            const columns = toNumber(metadata.slice(66, 68));
            const paletteLength = toNumber(metadata.slice(74, 75));
            let seek = 75 + rows * columns + paletteLength * 3;
            const signatures = toNumber(art.slice(seek, seek + 4));
            seek += signatures * 85 + 4;

            const result = [];
            for (let i = seek; i < art.length; i += 64) {
              const createdAt = toNumber(art.slice(i, i + 6));
              const _identity = hexlify(
                new Uint8Array(art.slice(i + 38, i + 58))
              );
              const colorIndex = toNumber(art.slice(i + 58, i + 59));
              const positionIndex = toNumber(art.slice(i + 59, i + 63));
              const iteration = toNumber(art.slice(i + 63, i + 64));

              if (!identity || _identity === identity.toLowerCase())
                result.push({
                  createdAt,
                  colorIndex,
                  positionIndex,
                  identity: _identity,
                  iteration,
                });
            }

            return result;
          })
        : database
            .getActivityByDrawing(sessionHash, identity)

            .then((activity) =>
              identity
                ? activity.map((a) => ({
                    revision: a.revision,
                    positionIndex: a.position_index,
                    colorIndex: a.color_index,
                    iteration: a.iteration,
                  }))
                : activity.map((a) => ({
                    identity: a.identity,
                    createdAt: a.created_at,
                    positionIndex: a.position_index,
                    colorIndex: a.color_index,
                    iteration: a.iteration,
                  }))
            )
    );

  const loadSessionContributions = (sessionHash: string) => {
    return Promise.all([
      loadSession(sessionHash),
      filesystem.loadFile(sessionHash),
      loadSessionCanvas(sessionHash),
      loadSessionActivity(sessionHash),
    ]).then(([s, canvas, _finalCanvas, activityLog]) => {
      if (!canvas) throw new NotFoundError();
      const finalCanvas = new Uint8Array(_finalCanvas);
      const canvasArray = new Uint8Array(
        s.iteration === s.maxIterations
          ? canvas.slice(75, 75 + s.rows * s.columns)
          : canvas
      );

      // also consider initial canvas in the calculation

      const contributions = new Map<string, number>();
      const historyLengths = new Map<number, number>();

      for (const activity of activityLog) {
        // need to make sure that iteration was not the same
        contributions.set(
          activity.identity as string,
          /*(50 -
            getColorDiff(
              0,
              activity.colorIndex,
              finalCanvas[activity.positionIndex]
            )) **/
          getPaintCost(
            historyLengths.get(activity.positionIndex) || 0,
            activity.colorIndex,
            canvasArray[activity.positionIndex]
          ) *
            2 +
            (contributions.get(activity.identity as string) || 0)
        );

        canvasArray[activity.positionIndex] = activity.colorIndex;
      }

      return Array.from(contributions.entries())
        .sort(([, a], [, b]) => (a > b ? -1 : 1))
        .slice(0, 100);
    });
  };

  const finishSession = async (s: Session) => {
    // need to calculate contributions and create transactions
    const [activity, contributions, signatures, _initialCanvas] =
      await Promise.all([
        database.getActivityByDrawing(s.hash),
        loadSessionContributions(s.hash),
        database.getSignatures(s.hash),
        filesystem.loadFile(s.hash),
      ]);

    const artValue = contributions.reduce((acc, [i, c]) => acc + c, 0);

    if (!_initialCanvas) throw new Error("missing canvas");

    const palette = s.palette.split("|");

    // TODO: consider storing prompt history as well

    const finalFile = getBytes(
      concat([
        s.hash,
        s.revision,
        zeroPadValue(toBeArray(s.rows), 2),
        zeroPadValue(toBeArray(s.columns), 2),
        zeroPadValue(toBeArray(s.created_at), 6),
        zeroPadValue(toBeArray(palette.length), 1),
        ...palette.map((hex) => `0x${hex.slice(1)}`),
        new Uint8Array(_initialCanvas),
        zeroPadValue(toBeArray(signatures.length), 4),
        ...signatures.map(({ signature, identity }) =>
          concat([signature, identity])
        ),
        // so is this.
        ...activity.map(
          ({
            created_at,
            position_index,
            color_index,
            identity,
            revision,
            iteration,
          }) =>
            concat([
              zeroPadValue(toBeArray(created_at), 6),
              revision,
              identity,
              zeroPadValue(toBeArray(color_index), 1),
              zeroPadValue(toBeArray(position_index), 4),
              toBeArray(iteration),
            ])
        ),
      ])
    );

    return database
      .progressSession(s.hash, s.max_iterations)
      .then(() =>
        database.insertTransactions(
          contributions.map(([identity, contribution]) => ({
            identity,
            amount: contribution,
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
      .then(() => {
        const revisionCache = revisionCaches.get(s.hash) || [];
        if (revisionCache) {
          revisionCache
            .slice(0, -1)
            .forEach((r) => filesystem.removeFile(r.revision));
          revisionCaches.delete(s.hash);
        }

        // need to get all signatures + history and remove from database
        // also mint the required tokens

        return Promise.all([
          contract.submitDrawing(sha256(finalFile), artValue),
          filesystem.saveFile(finalFile, s.hash),
        ]);
      })
      .then(([txHash]) => {
        /* TODO: remove this once we are sure everything works fine
        Promise.all([
          database.setSessionTransactionHash(s.hash, txHash),
          database.deleteSessionPaint(s.hash),
          database.deleteSessionActivity(s.hash),
          database.deleteSessionSignatures(s.hash),
          database.deleteSessionPrompts(s.hash),
        ]);*/

        return null;
      });
  };

  const currentSessions = await database.getActiveSessions();

  const progressSession = (session: Session): Promise<null> => {
    if (session.current_iteration === session.max_iterations - 1) {
      return finishSession(session);
    }

    return Promise.all([
      database.progressSession(session.hash, session.current_iteration + 1),
      database.addParticipantsPaint(session.hash, ITERATION_PAINT),
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
    database
      .getUserSessionPaint(sessionHash, identity)
      .then((result) =>
        result === null
          ? database
              .getUserMetrics(identity)
              .then(([userStatus, invitations]) =>
                userStatus?.is_vip
                  ? 2 * DEFAULT_PAINT +
                    (invitations?.invitationCount || 0) * INVITATION_BONUS
                  : DEFAULT_PAINT
              )
          : result.paint
      );

  for (const s of currentSessions) {
    if (s.current_iteration > 0 && s.current_iteration < s.max_iterations) {
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
        activity.map(
          ({ iteration, identity, position_index, color_index }) => ({
            iteration,
            identity,
            positionIndex: position_index,
            colorIndex: color_index,
          })
        )
      ),
    loadArchivedSessions: (limit?: number, offset?: number) =>
      database.getArchivedSessions(limit, offset).then((sessions) =>
        sessions.map(
          ({
            rows,
            columns,
            hash,
            palette,
            participants,
            session_type,
            prompt,
            created_at,
          }) => ({
            hash,
            rows,
            columns,
            participants,
            prompt,
            palette: palette.split("|"),
            sessionType: session_type,
            createdAt: created_at,
          })
        )
      ),

    loadSessionParticipants: (sessionHash: string) =>
      database
        .getSessionParticipants(sessionHash)
        .then((participants) => participants.map(({ identity }) => identity)),

    loadSessions: (identity?: string) =>
      database.getActiveSessions(identity).then((sessions) =>
        sessions.map(
          ({
            rows,
            columns,
            hash,
            participants,
            tx_hash,
            palette,
            session_type,
            iteration_started_at,
            current_iteration,
            prompt,
            max_iterations,
            revision,
          }) => ({
            revision,
            hash,
            rows,
            columns,
            participants,
            txHash: tx_hash,
            iteration: current_iteration,
            prompt,
            palette: palette.split("|"),
            sessionType: session_type,
            iterationStartedAt: iteration_started_at,
            iterationEndsAt: iteration_started_at + ITERATION_LENGTH,
            maxIterations: max_iterations,
          })
        )
      ),

    loadSessionGIF: (sessionHash: string) => {
      return Promise.all([
        loadSession(sessionHash),
        loadSessionCanvas(sessionHash),
      ]).then(([s, canvas]) => {
        const canvasArray = Array.from(canvas);
        const encoder = new GIFEncoder(s.columns, s.rows);
        const stream = encoder.createReadStream();
        const c = createCanvas(s.columns, s.rows);
        const imageData = createImageData(
          new Uint8ClampedArray(
            canvasArray.flatMap((i) => {
              const result = chroma(s.palette[i]).rgba();
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
        if (!canvas) throw new NotFoundError();
        const canvasArray = new Uint8Array(
          s.iteration === s.maxIterations
            ? canvas.slice(75, 75 + s.rows * s.columns)
            : canvas
        );
        const encoder = new GIFEncoder(s.columns, s.rows);
        const stream = encoder.createReadStream();
        const c = createCanvas(s.columns, s.rows);
        const canvasToImageData = (_canvas: Uint8Array) =>
          createImageData(
            new Uint8ClampedArray(
              Array.from(_canvas).flatMap((i) => {
                const result = chroma(s.palette[i]).rgba();
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

        let lastIteration = 0;

        for (const activity of activityLog) {
          if (lastIteration < activity.iteration) {
            lastIteration = activity.iteration;
            ctx.putImageData(canvasToImageData(canvasArray), 0, 0);
            encoder.addFrame(ctx as any);
          }

          canvasArray[activity.position_index] = activity.color_index;
        }

        encoder.addFrame(ctx as any);

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
    loadSessionActivity,
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
      if (prompt.length > 32 || !(await spellCheck(prompt))) {
        throw new BadRequestError(`invalid prompt: ${prompt}`);
      }

      const session = await loadSession(sessionHash);

      if (session.iteration > 0)
        throw new BadRequestError("session prompt completed");

      lockedSessions.add(sessionHash);

      try {
        const r = session.rows * session.columns;
        const consensusRequirement =
          CONSENSUS_MULTIPLIER *
          Math.round((Math.log(r) / Math.log(2)) * (r / 16384));

        const matchingPrompts = await database.getMatchingPrompts(
          sessionHash,
          prompt
        );

        await database.updateUserPaint(sessionHash, identity, DEFAULT_PAINT);

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

          const promptSessions = await database.getPromptSessions();

          if (promptSessions.length === 0) {
            await generateDrawing(
              nextSize >= DIMENSIONS.length
                ? DIMENSIONS.length - 1
                : nextSize < 0
                ? 0
                : nextSize
            );
          }

          const s = await database.getSessionByHash(sessionHash);
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

    unlockMorePaint: (sessionHash: string, identity: string) =>
      loadSessionPaint(sessionHash, identity).then((paintLeft) =>
        database.updateUserPaint(
          sessionHash,
          identity,
          paintLeft + UNLOCKED_PAINT
        )
      ),

    paint: async (
      sessionHash: string,
      identity: string,
      revision: string,
      signature: string,
      positionIndex: number,
      colorIndex: number
    ) => {
      // if first iteration check if it's first 16 colors.
      /*
      if (colorIndex > 15) {
        throw new BadRequestError("color not allowed");
      }*/

      const activity = await database.getActivityByDrawing(
        sessionHash,
        identity
      );

      activity.push({
        identity,
        iteration: 0, // TBD: iteration not part of signature should it be?
        revision,
        color_index: colorIndex,
        position_index: positionIndex,
        created_at: clock.now, // TBD
      });

      // something is pretty bad here
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
        let [[userMetrics], session, paintLeft] = await Promise.all([
          database.getUserMetrics(identity),
          database.getSessionByHash(sessionHash),
          loadSessionPaint(sessionHash, identity),
        ]);

        if (!session) throw new NotFoundError("session not found");
        if (positionIndex < 0 || positionIndex > session.rows * session.columns)
          throw new BadRequestError("incorrect position");

        const palette = session.palette.split("|");
        if (colorIndex >= palette.length)
          throw new BadRequestError("incorrect color");
        if (
          session.current_iteration === 0 ||
          session.current_iteration === session.max_iterations
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

        let originalColorIndex = findOriginalColorIndex(
          newCanvas[positionIndex],
          session.current_iteration,
          history
        );
        originalColorIndex =
          originalColorIndex === null
            ? new Uint8Array((await filesystem.loadFile(session.hash)) || [])[
                positionIndex
              ]
            : originalColorIndex;

        const matchedColorIndex = findClosestColors(
          palette,
          originalColorIndex,
          8
        ).findIndex((c) => c === colorIndex);

        if (matchedColorIndex === -1)
          throw new BadRequestError("transition not allowed");

        const baseCost = getPaintCost(
          history.reduce(
            (acc, a) =>
              a.iteration === session!.current_iteration ||
              acc.includes(a.iteration)
                ? acc
                : [...acc, a.iteration],
            [] as number[]
          ).length,
          colorIndex,
          newCanvas[positionIndex]
        );

        const paintCost = (matchedColorIndex < 4 ? 1 : 2) * baseCost;

        if (newCanvas[positionIndex] === colorIndex)
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
          colorIndex,
          session.current_iteration
        );

        return Promise.all([
          filesystem.saveFile(newCanvas),
          database.updateRevision(sessionHash, updatedRevision),
          database.updateUserPaint(sessionHash, identity, paintLeft),
          database.updateSignature(sessionHash, identity, signature),
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
