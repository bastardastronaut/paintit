import { verbose, Database as SQLiteDatabse } from "sqlite3";

export type Session = {
  prompt_word_length: number;
  session_type: number;
  hash: string;
  revision: string;
  prompt: string;
  rows: number;
  columns: number;
  palette_index: number;
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
  db: SQLiteDatabse;

  signals: Signals;

  constructor(signals: Signals) {
    //this.db = new (verbose().Database)(":memory:");
    this.db = new (verbose().Database)("test.sqlite");
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

  insertUserFromChain(accountId: string, tokens: number) {
    return this.upsert(
      `INSERT INTO users (identity, account_id, tokens, created_at) VALUES('${accountId}', '${accountId}', ${tokens}, unixepoch())`
    );
  }

  insertActivity(
    hash: string,
    revision: string,
    identity: string,
    positionIndex: number,
    colorIndex: number
  ) {
    return this.upsert(
      `INSERT INTO draw_activity (hash, revision, identity, position_index, color_index, iteration, created_at) VALUES('${hash}', '${revision}', '${identity}', ${positionIndex}, ${colorIndex}, 0, unixepoch())`
    );
  }

  insertSession(
    hash: string,
    rows: number,
    columns: number,
    paletteIndex: number,
    promptSize: number
  ) {
    return this.upsert(
      `INSERT INTO sessions (hash, session_type, revision, rows, columns, palette_index, current_iteration, iteration_started_at, created_at, prompt, prompt_word_length) VALUES('${hash}', ${SessionType.FREE}, '${hash}', ${rows}, ${columns}, ${paletteIndex}, 0, unixepoch(), unixepoch(), '', ${promptSize})`
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

  updateUserPaint(sessionHash: string, identity: string, paintLeft: number) {
    return this.upsert(
      `UPDATE session_paint SET paint='${paintLeft}' WHERE hash='${sessionHash}' AND identity='${identity}'`
    );
  }

  generateUserPaint(sessionHash: string, identity: string, paintLeft: number) {
    return this.upsert(
      `INSERT INTO session_paint (hash, identity, paint, last_action) VALUES('${sessionHash}', '${identity}', '${paintLeft}', unixepoch())`
    );
  }

  insertSignature(sessionHash: string, identity: string, signature: string) {
    return this.upsert(
      `INSERT INTO draw_signatures (hash, identity, signature) VALUES('${sessionHash}', '${identity}', '${signature}')`
    );
  }

  updateSignature(sessionHash: string, identity: string, signature: string) {
    return this.upsert(
      `UPDATE draw_signatures SET signature='${signature}' WHERE hash='${sessionHash}' AND identity='${identity}'`
    );
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

  addUserEmail(email: string) {}

  getUserByIdentity(identity: string) {
    return this.get(`SELECT * FROM users WHERE identity='${identity}'`);
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
    return this.get(`SELECT * FROM sessions WHERE hash='${hash}'`);
  }

  getLatestDrawing(): Promise<null | Session> {
    return this.get(`SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1`);
  }

  getActiveSessions(): Promise<Session[]> {
    return this.getAll(
      `SELECT * FROM sessions WHERE current_iteration < 5 ORDER BY created_at DESC`
    );
  }

  getPromptSessions(): Promise<Session[]> {
    return this.getAll(
      `SELECT * FROM sessions WHERE current_iteration == 0 ORDER BY created_at DESC`
    );
  }

  getActiveTransactions(identity: string): Promise<Transaction[]> {
    return this.getAll(
      `SELECT * FROM transactions WHERE withdrawal_id is NULL AND identity='${identity}' ORDER BY created_at DESC`
    );
  }

  getArchivedSessions(limit = 3, offset = 0): Promise<Session[]> {
    return this.getAll(
      `SELECT * FROM sessions WHERE current_iteration == 5 ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    );
  }

  resetParticipantsPaint(hash: string, paint: number) {
    return this.upsert(
      `UPDATE session_paint SET paint = ${paint} WHERE hash = '${hash}'`
    );
  }

  getPixelHistory(hash: string, positionIndex: number): Promise<Activity[]> {
    return this.getAll<Activity>(
      `SELECT position_index, color_index
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

  getPreviousCycleTransactions() {}

  private construct() {
    return new Promise((resolve) => {
      this.db.serialize(() => {
        this.db.run(
          "CREATE TABLE IF NOT EXISTS users (identity TEXT PRIMARY KEY, email TEXT, account_id TEXT, tokens INTEGER, last_login INTEGER, updated_at INTEGER, created_at INTEGER, is_vip BOOLEAN)"
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
          "CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, session_type INTEGER, rows INTEGER, columns INTEGER, palette_index INTEGER, revision TEXT, prompt TEXT, current_iteration INTEGER, iteration_started_at INTEGER, max_iterations INTEGER, iteration_length INTEGER, prompt_word_length INTEGER, created_at INTEGER)"
        );

        this.db.run(
          "CREATE TABLE IF NOT EXISTS draw_activity (hash TEXT, identity TEXT, revision TEXT, position_index INTEGER, color_index INTEGER, iteration INTEGER, created_at INTEGER, PRIMARY KEY (hash, identity, revision, created_at))"
        );

        // to store signatures from each user
        this.db.run(
          "CREATE TABLE IF NOT EXISTS draw_signatures (hash TEXT, identity TEXT, signature TEXT, PRIMARY KEY(hash, identity))"
        );

        this.db.run(
          "CREATE TABLE IF NOT EXISTS session_paint (hash TEXT, identity TEXT, paint INTEGER, last_action INTEGER, PRIMARY KEY(hash, identity))"
        );

        this.db.run(
          "CREATE TRIGGER IF NOT EXISTS paint_update AFTER UPDATE ON session_paint BEGIN update session_paint SET last_action = unixepoch() WHERE hash = NEW.hash AND identity = NEW.identity; END;"
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
      });

      resolve(true);
    });
  }
}
