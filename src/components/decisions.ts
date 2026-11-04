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
  /** Management sign-off for buys and reductions above the approval limit (rules.ts) */
  signoff?: "pending" | "approved" | "rejected";
  description?: string;
  /** value of the buy or of the stock released (IDR) */
  value?: number;
  reason?: string;
  sce?: boolean;
}

/** One line of the audit trail: every approve, reject, undo and sign-off, never overwritten. */
export interface LogEntry {
  at: string;
  role: string;
  kind: DecisionKind;
  material_no: number;
  description: string;
  event: string;
  qty?: number;
  value?: number;
  reason?: string;
}

/** A decision takes effect once approved and, where needed, signed off by Management. */
export const effective = (d: Decision) => d.status === "approved" && (!d.signoff || d.signoff === "approved");

const KEY = "caliber_decisions_v1";
const LOG_KEY = "caliber_decision_log_v1";
const EVENT = "caliber-decisions";

function store<T>(key: string, empty: T) {
  let cache: T | null = null;
  let raw: string | null = null;
  return {
    read(): T {
      try {
        const now = localStorage.getItem(key);
        if (cache && now === raw) return cache;
        raw = now;
        cache = now ? JSON.parse(now) : empty;
      } catch {
        cache = empty;
      }
      return cache!;
    },
    write(next: T) {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage unavailable: decisions live for this page only */
      }
      cache = next;
      raw = JSON.stringify(next);
      window.dispatchEvent(new Event(EVENT));
    },
  };
}

const decisionStore = store<Record<string, Decision>>(KEY, {});
const logStore = store<LogEntry[]>(LOG_KEY, []);

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
const EMPTY_LOG: LogEntry[] = [];

function log(d: Pick<Decision, "kind" | "material_no" | "qty" | "value" | "reason" | "description">, role: string, event: string) {
  logStore.write([
    ...logStore.read(),
    { at: new Date().toISOString(), role, kind: d.kind, material_no: d.material_no, description: d.description ?? "", event, qty: d.qty, value: d.value, reason: d.reason },
  ]);
}

export function useDecisions() {
  const decisions = useSyncExternalStore(subscribe, decisionStore.read, () => EMPTY);
  const decide = useCallback((d: Omit<Decision, "id" | "at">) => {
    const id = `${d.kind}:${d.material_no}`;
    decisionStore.write({ ...decisionStore.read(), [id]: { ...d, id, at: new Date().toISOString() } });
    log(d, d.role, d.status === "rejected" ? "Rejected" : d.signoff === "pending" ? "Approved, sent for Management sign-off" : "Approved");
  }, []);
  const undo = useCallback((kind: DecisionKind, material_no: number) => {
    const next = { ...decisionStore.read() };
    const old = next[`${kind}:${material_no}`];
    delete next[`${kind}:${material_no}`];
    decisionStore.write(next);
    if (old) log(old, old.role, "Undone");
  }, []);
  const signoff = useCallback((id: string, approved: boolean) => {
    const cur = decisionStore.read()[id];
    if (!cur) return;
    decisionStore.write({ ...decisionStore.read(), [id]: { ...cur, signoff: approved ? "approved" : "rejected" } });
    log(cur, "management", approved ? "Signed off by Management" : "Sign-off refused by Management");
  }, []);
  const clearAll = useCallback(() => {
    decisionStore.write({});
    logStore.write([]);
  }, []);
  return { decisions, decide, undo, signoff, clearAll };
}

export function useDecisionLog() {
  return useSyncExternalStore(subscribe, logStore.read, () => EMPTY_LOG);
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
