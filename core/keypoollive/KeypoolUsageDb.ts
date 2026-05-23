/**
 * MIT License
 *
 * Copyright (c) 2026 Ronan LE MEILLAT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Persistent storage for per-key token usage and error tracking
import fs from "fs";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { DatabaseConnection } from "../indexing/refreshIndex.js";
import { getDevDataSqlitePath } from "../util/paths.js";

export type UsagePeriod = "hour" | "day" | "week" | "month";

export interface KeyUsageEntry {
  provider: string;
  modelId: string;
  keyOwner: string;
  keyHint: string;
  promptTokens: number;
  completionTokens: number;
}

export interface KeyErrorEntry {
  provider: string;
  modelId: string;
  keyOwner: string;
  keyHint: string;
  errorCode: number | null;
}

export interface KeyUsageStat {
  period: string;
  provider: string;
  keyOwner: string;
  keyHint: string;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
}

export interface KeyErrorStat {
  provider: string;
  keyOwner: string;
  keyHint: string;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  lastErrorCode: number | null;
}

function periodFormat(period: UsagePeriod): string {
  switch (period) {
    case "hour":
      return `strftime('%Y-%m-%d %H:00', datetime(timestamp/1000, 'unixepoch'))`;
    case "day":
      return `strftime('%Y-%m-%d', datetime(timestamp/1000, 'unixepoch'))`;
    case "week":
      return `strftime('%Y-W%W', datetime(timestamp/1000, 'unixepoch'))`;
    case "month":
      return `strftime('%Y-%m', datetime(timestamp/1000, 'unixepoch'))`;
  }
}

function periodCutoffMs(period: UsagePeriod): number {
  const now = Date.now();
  switch (period) {
    case "hour":
      return now - 60 * 60 * 1000;
    case "day":
      return now - 24 * 60 * 60 * 1000;
    case "week":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "month":
      return now - 30 * 24 * 60 * 60 * 1000;
  }
}

export class KeypoolUsageDb {
  private static db: DatabaseConnection | null = null;

  private static async createTable(db: DatabaseConnection): Promise<void> {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS keypoollive_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        key_owner TEXT NOT NULL,
        key_hint TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        is_error INTEGER NOT NULL DEFAULT 0,
        error_code INTEGER DEFAULT NULL
      )
    `);
    await db.exec(
      `CREATE INDEX IF NOT EXISTS idx_kpl_usage_ts ON keypoollive_usage(timestamp)`,
    );
  }

  static async get(): Promise<DatabaseConnection | null> {
    const path = getDevDataSqlitePath();
    if (KeypoolUsageDb.db && fs.existsSync(path)) {
      return KeypoolUsageDb.db;
    }
    KeypoolUsageDb.db = await open({
      filename: path,
      driver: sqlite3.Database,
    });
    await KeypoolUsageDb.db.exec("PRAGMA busy_timeout = 3000;");
    await KeypoolUsageDb.createTable(KeypoolUsageDb.db);
    return KeypoolUsageDb.db;
  }

  static async logUsage(entry: KeyUsageEntry): Promise<void> {
    const db = await KeypoolUsageDb.get();
    await db?.run(
      `INSERT INTO keypoollive_usage
        (timestamp, provider, model_id, key_owner, key_hint, prompt_tokens, completion_tokens, is_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        Date.now(),
        entry.provider,
        entry.modelId,
        entry.keyOwner,
        entry.keyHint,
        entry.promptTokens,
        entry.completionTokens,
      ],
    );
  }

  static async logError(entry: KeyErrorEntry): Promise<void> {
    const db = await KeypoolUsageDb.get();
    await db?.run(
      `INSERT INTO keypoollive_usage
        (timestamp, provider, model_id, key_owner, key_hint, prompt_tokens, completion_tokens, is_error, error_code)
       VALUES (?, ?, ?, ?, ?, 0, 0, 1, ?)`,
      [
        Date.now(),
        entry.provider,
        entry.modelId,
        entry.keyOwner,
        entry.keyHint,
        entry.errorCode,
      ],
    );
  }

  static async getUsageStats(period: UsagePeriod): Promise<KeyUsageStat[]> {
    const db = await KeypoolUsageDb.get();
    const fmt = periodFormat(period);
    const cutoff = periodCutoffMs(period);
    const rows = await db?.all(
      `SELECT
        ${fmt} AS period,
        provider,
        key_owner AS keyOwner,
        key_hint  AS keyHint,
        SUM(prompt_tokens)      AS promptTokens,
        SUM(completion_tokens)  AS completionTokens,
        COUNT(*)                AS requestCount
       FROM keypoollive_usage
       WHERE is_error = 0 AND timestamp >= ?
       GROUP BY period, provider, key_owner, key_hint
       ORDER BY period DESC, key_owner`,
      [cutoff],
    );
    return (rows ?? []) as KeyUsageStat[];
  }

  static async getErrorStats(period: UsagePeriod): Promise<KeyErrorStat[]> {
    const db = await KeypoolUsageDb.get();
    const cutoff = periodCutoffMs(period);
    const rows = await db?.all(
      `SELECT
        provider,
        key_owner                             AS keyOwner,
        key_hint                              AS keyHint,
        COUNT(*)                              AS totalRequests,
        SUM(is_error)                         AS errorCount,
        ROUND(100.0 * SUM(is_error) / COUNT(*), 1) AS errorRate,
        MAX(CASE WHEN is_error = 1 THEN error_code END) AS lastErrorCode
       FROM keypoollive_usage
       WHERE timestamp >= ?
       GROUP BY provider, key_owner, key_hint
       ORDER BY errorRate DESC, key_owner`,
      [cutoff],
    );
    return (rows ?? []) as KeyErrorStat[];
  }
}
