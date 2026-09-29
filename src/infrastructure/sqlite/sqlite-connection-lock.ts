import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";

const activeConnections = new AsyncLocalStorage<ReadonlySet<DatabaseSync>>();
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
