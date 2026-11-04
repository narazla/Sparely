import "server-only";
import Database from "better-sqlite3";
import path from "node:path";

let db: Database.Database | null = null;

/** Read-only handle to data/caliber.db (built by pipeline/build_db.py). */
export function getDb(): Database.Database {
  if (!db) {
    const file = path.join(process.cwd(), "data", "caliber.db");
    db = new Database(file, { readonly: true, fileMustExist: true });
  }
  return db;
}

export function all<T>(sql: string, ...args: unknown[]): T[] {
  return getDb().prepare(sql).all(...args) as T[];
}

export function one<T>(sql: string, ...args: unknown[]): T | undefined {
  return getDb().prepare(sql).get(...args) as T | undefined;
}
