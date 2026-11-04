"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Decisions taken in the workspaces. The prototype keeps them in the browser
 * (localStorage) so the hosted SQLite database stays read-only; in production
 * they would be written back to the ERP.
 */
export type DecisionKind = "reorder" | "transfer" | "request" | "tam" | "param" | "reduce" | "insurance";
export interface Decision {
  id: string;
  kind: DecisionKind;
  material_no: number;
  status: "approved" | "rejected";
  qty?: number;
  need_by?: string;
  role: string;
  at: string;
  source?: string;
}

const KEY = "caliber_decisions_v1";
const EVENT = "caliber-decisions";
let cache: Record<string, Decision> | null = null;
let raw: string | null = null;

function read(): Record<string, Decision> {
  try {
    const now = localStorage.getItem(KEY);
    if (cache && now === raw) return cache;
    raw = now;
    cache = now ? JSON.parse(now) : {};
  } catch {
    cache = {};
  }
  return cache!;
}

function write(next: Record<string, Decision>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: decisions live for this page only */
  }
  cache = next;
  raw = JSON.stringify(next);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const on = () => cb();
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", on);
  };
}

const EMPTY: Record<string, Decision> = {};

export function useDecisions() {
  const decisions = useSyncExternalStore(subscribe, read, () => EMPTY);
  const decide = useCallback((d: Omit<Decision, "id" | "at">) => {
    const id = `${d.kind}:${d.material_no}`;
    write({ ...read(), [id]: { ...d, id, at: new Date().toISOString() } });
  }, []);
  const undo = useCallback((kind: DecisionKind, material_no: number) => {
    const next = { ...read() };
    delete next[`${kind}:${material_no}`];
    write(next);
  }, []);
  const clearAll = useCallback(() => write({}), []);
  return { decisions, decide, undo, clearAll };
}

export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
