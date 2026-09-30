import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";

const activeConnections = new AsyncLocalStorage<ReadonlySet<DatabaseSync>>();
const activeTransactions = new AsyncLocalStorage<ReadonlySet<DatabaseSync>>();
type ConnectionState = { tail: Promise<void>; pending: number; active: boolean };
const connectionStates = new WeakMap<DatabaseSync, ConnectionState>();

function stateFor(database: DatabaseSync): ConnectionState {
  let state = connectionStates.get(database);
  if (!state) {
    state = { tail: Promise.resolve(), pending: 0, active: false };
    connectionStates.set(database, state);
  }
  return state;
}

export async function withSqliteConnectionLock<T>(
  database: DatabaseSync,
  operation: () => T | Promise<T>,
): Promise<T> {
  const active = activeConnections.getStore();
  if (active?.has(database)) return operation();

  const state = stateFor(database);
  if (!state.active && state.pending === 0) {
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    state.tail = state.tail.then(() => current);
    state.active = true;
    const nextActive = new Set(active ?? []);
    nextActive.add(database);
    try {
      return await activeConnections.run(nextActive, operation);
    } finally {
      state.active = false;
      release();
    }
  }

  const previous = state.tail;
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  state.pending += 1;
  state.tail = previous.then(() => current);
  await previous;
  state.pending -= 1;
  state.active = true;

  const nextActive = new Set(active ?? []);
  nextActive.add(database);
  try {
    return await activeConnections.run(nextActive, operation);
  } finally {
    state.active = false;
    release();
  }
}

export function tryWithSqliteConnectionLock<T>(
  database: DatabaseSync,
  operation: () => T,
): T {
  const active = activeConnections.getStore();
  if (active?.has(database)) return operation();

  const state = stateFor(database);
  if (state.active || state.pending > 0) throw new Error("SQLite connection is busy");
  state.active = true;
  const nextActive = new Set(active ?? []);
  nextActive.add(database);
  try {
    return activeConnections.run(nextActive, operation);
  } finally {
    state.active = false;
  }
}

export async function withSqliteTransaction<T>(
  database: DatabaseSync,
  operation: () => Promise<T>,
): Promise<T> {
  const active = activeTransactions.getStore();
  if (active?.has(database)) return operation();

  return withSqliteConnectionLock(database, async () => {
    await beginImmediateWithRetry(database);
    let transactionStarted = true;
    const nextActive = new Set(active ?? []);
    nextActive.add(database);
    try {
      const result = await activeTransactions.run(nextActive, operation);
      database.exec("COMMIT");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) database.exec("ROLLBACK");
      throw error;
    }
  });
}

async function beginImmediateWithRetry(database: DatabaseSync): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      database.exec("BEGIN IMMEDIATE");
      return;
    } catch (error) {
      if (!isSqliteBusy(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message);
}
