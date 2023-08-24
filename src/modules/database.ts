import { verbose, Database as SQLiteDatabse } from "sqlite3";

export type Session = {
  tx_hash: string;
  participants: number;
  max_iterations: number;
  session_type: number;
  hash: string;
  revision: string;
  prompt: string;
  rows: number;
  palette: string;
  columns: number;
  current_iteration: number;
  iteration_started_at: number;
  created_at: number;
};

export type Transaction = {
  amount: number;
  created_at: number;
  identity: string;
  message: string;
};

export type Withdrawal = {
  amount: number;
  withdrawal_id: string;
  identity: string;
};

export type SessionPaint = {
  paint: number;
  identity: string;
  hash: string;
};

export type Activity = {
  created_at: number;
  position_index: number;
  color_index: number;
  identity: string;
  revision: string;
  iteration: number;
};

export enum SessionType {
  FREE,
  PREMIUM,
  ULTIMATE,
}

export enum CaptchaAttemptOutcome {
  SUCCESS,
  FAILURE,
}

type Signals = {
  onIterationProgress: (hash: string, iteration: number) => void;
};

export default class Database {
  private db: SQLiteDatabse;

  signals: Signals;

  constructor(path: string, signals: Signals) {
    //this.db = new (verbose().Database)(":memory:");
    this.db = new (verbose().Database)(`${path}/test.sqlite`);
    this.signals = signals;
  }

  initialize() {
    return this.construct();
  }

  private upsert<T>(statement: string): Promise<boolean> {
    return new Promise((resolve, reject) =>
      this.db.run(statement, (error) => {
        if (error) {
          reject(error);
        }
        resolve(true);
      })
    );
  }

  private get<T>(statement: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      this.db.get(statement, (error, result: T) => {
        if (error) {
          reject(error);
        }

        if (!result) resolve(null);

        resolve(result);
      });
    });
  }

  private getAll<T>(statement: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(statement, (error, result: T[]) => {
        if (error) {
          reject(error);
        }

        if (!result) resolve([]);

        resolve(result);
      });
    });
  }

  insertUsername(identity: string, username: string) {
    return this.upsert(
      `INSERT INTO users (identity, nickname) VALUES('${identity}', '${username}')`
    );
  }

  insertUser(accountId: string) {
    return this.upsert(
      `INSERT INTO users (identity, account_id, tokens, created_at) VALUES('${accountId}', '${accountId}', 0, unixepoch())`
    );
  }

  insertCaptchaAttempt(
    filename: string,
    identity: string,
    outcome: CaptchaAttemptOutcome
  ) {
    return this.upsert(
      `INSERT INTO captcha_attempts (filename, identity, outcome) VALUES('${filename}', '${identity}', ${outcome})`
    );
  }

  loadCaptchaAttempts(
    filename: string
  ): Promise<Array<{ outcome: CaptchaAttemptOutcome }>> {
    // TODO: add blacklist for identity
    return this.getAll(
      `SELECT outcome FROM captcha_attempts WHERE filename == '${filename}'`
    );
  }

  insertTransactions(
    transactions: Array<{
      identity: string;
      amount: number;
      message: string;
    }>
  ) {
    return new Promise((r) => {
      const stmt = this.db.prepare(
        "INSERT INTO transactions (identity, amount, message, created_at) VALUES(?, ?, ?, unixepoch())"
      );

      for (const tx of transactions) {
        stmt.run(tx.identity, tx.amount, tx.message);
      }

      stmt.finalize(r);
    });
  }

  // probably not necessary
  // we can do it via registration on demand
  insertUserFromChain(identity: string, accountId: string, isVip: boolean) {
    return this.upsert(
      `INSERT INTO users (identity, account_id, is_vip, created_at) VALUES('${identity}', '${accountId}', ${isVip} unixepoch())`
    );
  }

  insertActivity(
    hash: string,
    revision: string,
    identity: string,
    positionIndex: number,
    colorIndex: number,
    iteration: number
  ) {
    return this.upsert(
      `INSERT INTO draw_activity (hash, revision, identity, position_index, color_index, iteration, created_at) VALUES('${hash}', '${revision}', '${identity}', ${positionIndex}, ${colorIndex}, ${iteration}, unixepoch())`
    );
  }

  insertSession(
    hash: string,
    rows: number,
    columns: number,
    palette: string[],
    maxIterations: number
  ) {
    return this.upsert(
      `INSERT INTO sessions (hash, session_type, revision, rows, columns, palette, current_iteration, iteration_started_at, created_at, prompt, max_iterations) VALUES('${hash}', ${
        SessionType.FREE
      }, '${hash}', ${rows}, ${columns}, '${palette.join(
        "|"
      )}', 0, unixepoch(), unixepoch(), '', ${maxIterations})`
    );
  }

  progressSession(sessionHash: string, nextIteration: number) {
    return this.upsert(
      `UPDATE sessions SET current_iteration=${nextIteration}, iteration_started_at=unixepoch() WHERE hash='${sessionHash}'`
    ).then((result) => {
      this.signals.onIterationProgress(sessionHash, nextIteration);
      return result;
    });
  }

  updateRevision(sessionHash: string, revision: string) {
    return this.upsert(
      `UPDATE sessions SET revision='${revision}' WHERE hash='${sessionHash}'`
    );
  }

  updateSessionPrompt(sessionHash: string, prompt: string, isFinal = false) {
    return this.upsert(
      `UPDATE sessions SET prompt='${prompt}'${
        isFinal ? ", current_iteration=1, iteration_started_at=unixepoch()" : ""
      } WHERE hash='${sessionHash}'`
    );
  }

  setSessionTransactionHash(sessionHash: string, transactionHash: string) {
    return this.upsert(
      `UPDATE sessions SET tx_hash='${transactionHash}' WHERE hash='${sessionHash}'`
    );
  }

  updateUserPaint(sessionHash: string, identity: string, paintLeft: number) {
    return this.upsert(
      `INSERT INTO session_paint (hash, identity, paint) VALUES('${sessionHash}', '${identity}', '${paintLeft}')
      ON CONFLICT (identity, hash) DO UPDATE SET paint='${paintLeft}'`
    );
  }

  updateSignature(sessionHash: string, identity: string, signature: string) {
    return this.upsert(
      `INSERT INTO draw_signatures (hash, identity, signature) VALUES('${sessionHash}', '${identity}', '${signature}')
      ON CONFLICT (identity, hash) DO UPDATE SET signature='${signature}'`
    );
  }

  getSignatures(sessionHash: string) {
    return this.getAll<{ signature: string; identity: string }>(
      `SELECT identity, signature FROM draw_signatures WHERE hash='${sessionHash}'`
    );
  }

  getUserIterationContributions(
    sessionHash: string,
    identity: string,
    iteration: number
  ) {
    return this.get<{ iterationCount: number }>(
      `SELECT COUNT(*) as iterationCount FROM draw_activity WHERE hash='${sessionHash}' AND LOWER(identity)=LOWER('${identity}') AND iteration=${iteration}`
    );
  }

  getUserMetrics(identity: string) {
    return Promise.all([
      this.get<{ is_vip: boolean; is_verified: boolean }>(
        `SELECT is_vip, is_verified FROM users WHERE LOWER(identity)=LOWER('${identity}')`
      ),
      this.get<{ invitationCount: number }>(
        `SELECT COUNT(*) AS invitationCount FROM users WHERE invited_by='${identity}' AND is_verified=TRUE`
      ),
    ]);
  }

  insertSessionPrompt(
    sessionHash: string,
    identity: string,
    promptText: string,
    signature: string
  ) {
    return this.upsert(
      `INSERT INTO session_prompts (hash, identity, text, signature) VALUES('${sessionHash}', '${identity}', '${promptText}', '${signature}')
      ON CONFLICT (identity, hash) DO UPDATE SET signature='${signature}', text='${promptText}'`
    );
  }

  deleteSessionPrompts(sessionHash: string) {
    return this.upsert(
      `DELETE FROM session_prompts WHERE hash='${sessionHash}'`
    );
  }

  deleteSessionActivity(sessionHash: string) {
    return this.upsert(`DELETE FROM draw_activity WHERE hash='${sessionHash}'`);
  }

  deleteSessionSignatures(sessionHash: string) {
    return this.upsert(
      `DELETE FROM draw_signatures WHERE hash='${sessionHash}'`
    );
  }

  deleteSessionPaint(sessionHash: string) {
    return this.upsert(`DELETE FROM session_paint WHERE hash='${sessionHash}'`);
  }

  addUserEmail(identity: string, email: string, verificationCode: number) {
    return this.upsert(
      `UPDATE users SET email='${email}', verification_code=${verificationCode} WHERE identity='${identity}'`
    );
  }

  verifyUser(email: string) {
    return this.upsert(
      `UPDATE users SET is_verified=TRUE WHERE email='${email}'`
    );
  }

  getUserByIdentity(identity: string) {
    return this.get(`SELECT * FROM users WHERE identity='${identity}'`);
  }

  getUsernames() {
    return this.getAll(`SELECT identity, nickname FROM users`);
  }

  getUserSessionPaint(sessionHash: string, identity: string) {
    return this.get<SessionPaint>(
      `SELECT * FROM session_paint WHERE hash='${sessionHash}' AND identity='${identity}'`
    );
  }

  getUserSessionPrompt(sessionHash: string, identity: string) {
    return this.get<{ text: string }>(
      `SELECT text FROM session_prompts WHERE hash='${sessionHash}' AND identity='${identity}'`
    );
  }

  getSessionByHash(hash: string): Promise<null | Session> {
    return this.get<Session>(
      `SELECT *, sessions.hash as hash, COUNT(*) AS participants FROM sessions LEFT JOIN session_prompts ON session_prompts.hash = sessions.hash LEFT JOIN session_paint ON session_paint.hash = sessions.hash WHERE sessions.hash='${hash}' GROUP BY sessions.hash`
    )
  }

  getActiveSessions(): Promise<Session[]> {
    return this.getAll(
      `SELECT *, sessions.hash as hash, COUNT(*) AS participants FROM sessions LEFT JOIN session_prompts ON sessions.hash = session_prompts.hash LEFT JOIN session_paint ON session_paint.hash = sessions.hash WHERE current_iteration < max_iterations GROUP BY sessions.hash ORDER BY created_at DESC`
    );
  }

  getPromptSessions(): Promise<Session[]> {
    return this.getAll(
      `SELECT * FROM sessions WHERE current_iteration == 0 ORDER BY created_at DESC`
    );
  }

  getActiveTransactions(identity: string): Promise<Transaction[]> {
    return this.getAll(
      `SELECT * FROM transactions WHERE withdrawal_id is NULL AND LOWER(identity)=LOWER('${identity}') ORDER BY created_at DESC`
    );
  }

  getArchivedSessions(limit = 3, offset = 0): Promise<Session[]> {
    return this.getAll(
      `SELECT *, sessions.hash as hash, COUNT(*) AS participants FROM sessions LEFT JOIN session_paint ON session_paint.hash = sessions.hash WHERE current_iteration == max_iterations  GROUP BY sessions.hash ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    );
  }

  addParticipantsPaint(hash: string, paintToAdd: number) {
    return this.upsert(
      `UPDATE session_paint SET paint = floor(paint * 0.75) + ${paintToAdd} WHERE hash = '${hash}'`
    );
  }

  // should this be authorized?
  getPixelHistory(hash: string, positionIndex: number): Promise<Activity[]> {
    return this.getAll<Activity>(
      `SELECT iteration, position_index, color_index, identity
FROM draw_activity
WHERE hash='${hash}'
AND position_index=${positionIndex}
ORDER BY created_at ASC`
    );
  }

  getSessionPrompts(sessionHash: string) {
    return this.getAll<{ text: string; votes: number }>(
      `SELECT text, COUNT(*) as votes FROM session_prompts WHERE hash='${sessionHash}' GROUP BY text`
    );
  }

  getSessionParticipants(sessionHash: string) {
    return Promise.all([
      // eventually it'll be just like this
      this.getAll<{ identity: string }>(
        `SELECT identity FROM session_prompts WHERE hash='${sessionHash}'`
      ),
      this.getAll<{ identity: string }>(
        `SELECT identity FROM session_paint WHERE hash='${sessionHash}'`
      ),
    ]).then(([prompts,paints]) => {
      // this probably should be done on SQL level..
      const identities = new Set()

      for (const i of prompts) {
        identities.add(i)
      }

      for (const i of paints) {
        identities.add(i)
      }

      return Array.from(identities).map(i => ({identity: i}))
    });
  }

  isParticipant(sessionHash: string, identity: string) {
    return this.getAll<{ identity: string }>(
      `SELECT identity FROM session_prompts WHERE hash='${sessionHash}' AND identity='${identity}'`
    );
  }

  getActivityByDrawing(hash: string, identity?: string) {
    return this.getAll<Activity>(
      `SELECT * FROM draw_activity WHERE hash='${hash}'${
        identity ? ` AND identity='${identity}'` : ""
      } ORDER BY created_at ASC`
    );
  }

  getMatchingPrompts(hash: string, text: string) {
    return this.get<{ matchCount: number }>(
      `SELECT COUNT(*) AS matchCount from session_prompts WHERE hash='${hash}' AND LOWER(text) == LOWER('${text}')`
    );
  }

  insertInvitationResponse(invitationId: string, responseData: any) {
    return this.upsert(
      `INSERT INTO wedding_rsvp (invitation_id, rsvp, attendees, meal_preferences, song_request, comments, recorded_at) VALUES('${invitationId}', ${responseData.rsvp}, '${responseData.attendees}', '${responseData.mealPreferences}', '${responseData.songRequest}', '${responseData.comment}', unixepoch())
      ON CONFLICT (invitation_id) DO UPDATE SET rsvp='${responseData.rsvp}', attendees='${responseData.attendees}', song_request='${responseData.songRequest}', meal_preferences='${responseData.mealPreferences}', comments='${responseData.comment}', modified_at=unixepoch()`
    );
  }

  getInvitationResponses() {
    return this.getAll(`SELECT * FROM wedding_rsvp`);
  }

  getInvitationResponse(invitationId: string) {
    return this.get(
      `SELECT * FROM wedding_rsvp WHERE invitation_id='${invitationId}'`
    );
  }

  // security is sort of compromised here
  // this being public leaks information, can do authwindow check?
  getUserAuthorization(identity: string) {
    return this.get<{ sequence: number }>(
      `SELECT sequence FROM user_authorization WHERE identity='${identity}'`
    );
  }

  setUserAuthorization(identity: string, sequence: number) {
    return this.upsert(
      `INSERT INTO user_authorization (identity, sequence) VALUES('${identity}', ${sequence})
      ON CONFLICT (identity) DO UPDATE SET sequence=${sequence}`
    );
  }

  getPreviousCycleTransactions() {}

  private construct() {
    return new Promise((resolve) => {
      this.db.serialize(() => {
        // we don't necessarily need to keep track of users only those that are email registered
        this.db.run(
          "CREATE TABLE IF NOT EXISTS wedding_rsvp (invitation_id TEXT PRIMARY KEY, rsvp BOOLEAN, attendees TEXT, meal_preferences TEXT, song_request TEXT, comments TEXT, recorded_at INTEGER, modified_at INTEGER)"
        );

        this.db.run(
          "CREATE TABLE IF NOT EXISTS users (identity TEXT PRIMARY KEY, email TEXT, account_id TEXT, tokens INTEGER, last_login INTEGER, updated_at INTEGER, nickname TEXT, created_at INTEGER, is_vip BOOLEAN, is_verified BOOLEAN, invited_by TEXT, verification_code INTEGER)"
        );

        this.db.run(
          "CREATE TRIGGER IF NOT EXISTS users_update AFTER UPDATE ON users BEGIN update users SET updated_at = unixepoch() WHERE identity = NEW.identity; END;"
        );

        // store all ART transactions
        this.db.run(
          "CREATE TABLE IF NOT EXISTS transactions (identity TEXT, amount INTEGER, message TEXT, created_at INTEGER, withdrawal_id TEXT)"
        );

        // iterations:
        // 0 -> prompt phase
        // 1-2 -> drawing with adaptive palette
        // 3 -> voting phase (TBD)
        this.db.run(
          "CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, session_type INTEGER, rows INTEGER, columns INTEGER, palette TEXT, revision TEXT, prompt TEXT, current_iteration INTEGER, iteration_started_at INTEGER, max_iterations INTEGER, iteration_length INTEGER, prompt_word_length INTEGER, tx_hash TEXT, created_at INTEGER)"
        );

        this.db.run(
          "CREATE TABLE IF NOT EXISTS draw_activity (hash TEXT, identity TEXT, revision TEXT, position_index INTEGER, color_index INTEGER, iteration INTEGER, created_at INTEGER, PRIMARY KEY (hash, identity, revision, created_at))"
        );

        // to store signatures from each user
        this.db.run(
          "CREATE TABLE IF NOT EXISTS draw_signatures (hash TEXT, identity TEXT, signature TEXT, PRIMARY KEY(hash, identity))"
        );

        this.db.run(
          "CREATE TABLE IF NOT EXISTS session_paint (hash TEXT, identity TEXT, paint INTEGER INTEGER, PRIMARY KEY(hash, identity))"
        );

        this.db.run(
          "CREATE TABLE IF NOT EXISTS session_prompts (hash TEXT, text TEXT, identity TEXT, signature TEXT, PRIMARY KEY(hash, identity))"
        );

        this.db.run(
          "CREATE TABLE IF NOT EXISTS captcha_attempts (filename TEXT, identity TEXT, outcome NUMBER)"
        );

        // need to keep track of withdrawals
        // ART is accumulated here and signatures are distributed freely until withdrawal

        // will need something like bidding, or let just people do it on opensea?
        this.db.run(
          "CREATE TABLE IF NOT EXISTS draw_votes (hash TEXT, value INTEGER, identity TEXT, signature TEXT, PRIMARY KEY(hash, identity))"
        );

        this.db.run(
          "CREATE TABLE IF NOT EXISTS user_authorization (identity TEXT PRIMARY KEY, sequence INTEGER)"
        );
      });

      resolve(true);
    });
  }
}
