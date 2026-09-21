"use client";

/**
 * 저장소. 로그인 상태면 Supabase, 아니면 localStorage.
 *
 * 첫 세션부터 로그인 벽을 세우지 않는 게 중요하다 — 말하기 앱에서 마찰은
 * 그대로 '안 함'이 된다. 로그인은 기기 간 동기화를 원할 때의 선택지로 둔다.
 */

import { supabase } from "./supabase";
import type { NewChunk, Stats, StoredChunk, StoredSession, StoredTurn } from "./types";
import type { Report } from "./gemini";

const LS_SESSIONS = "speaktime.sessions.v1";
const LS_CHUNKS = "speaktime.chunks.v1";

/** 세션 카운트 기준 간격 반복. 주 3~4회여도 스케줄이 무너지지 않는다. */
export const SRS_STEPS = [1, 3, 7, 14, 30];

export function nextDue(currentSessionCount: number, intervalStep: number): number {
  const gap = SRS_STEPS[Math.min(intervalStep, SRS_STEPS.length - 1)];
  return currentSessionCount + gap;
}

async function userId(): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

/* ------------------------------------------------------------ local store */

function readLocal<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function writeLocal<T>(key: string, rows: T[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    // 용량 초과 등은 조용히 무시한다. 기록보다 세션 진행이 우선.
  }
}

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* --------------------------------------------------------------- sessions */

export type SaveSessionInput = {
  scenarioId: string;
  speakingMs: number;
  hesitations: number;
  rescues: number;
  turns: StoredTurn[];
  report: Report | null;
};

export async function saveSession(input: SaveSessionInput): Promise<StoredSession> {
  const row: StoredSession = {
    id: uid(),
    createdAt: new Date().toISOString(),
    ...input,
  };

  const uidv = await userId();
  if (uidv) {
    const sb = supabase()!;
    const { data, error } = await sb
      .from("speak_sessions")
      .insert({
        user_id: uidv,
        scenario_id: input.scenarioId,
        speaking_ms: Math.round(input.speakingMs),
        hesitations: input.hesitations,
        rescues: input.rescues,
        turns: input.turns,
        report: input.report,
      })
      .select("id, created_at")
      .single();
    if (!error && data) {
      return { ...row, id: data.id as string, createdAt: data.created_at as string };
    }
    // 실패하면 로컬에라도 남긴다.
  }

  writeLocal(LS_SESSIONS, [row, ...readLocal<StoredSession>(LS_SESSIONS)].slice(0, 200));
  return row;
}

export async function listSessions(limit = 30): Promise<StoredSession[]> {
  const uidv = await userId();
  if (uidv) {
    const sb = supabase()!;
    const { data, error } = await sb
      .from("speak_sessions")
      .select("id, scenario_id, created_at, speaking_ms, hesitations, rescues, turns, report")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!error && data) {
      return data.map((r) => ({
        id: r.id as string,
        scenarioId: r.scenario_id as string,
        createdAt: r.created_at as string,
        speakingMs: r.speaking_ms as number,
        hesitations: r.hesitations as number,
        rescues: r.rescues as number,
        turns: (r.turns ?? []) as StoredTurn[],
        report: (r.report ?? null) as Report | null,
      }));
    }
  }
  return readLocal<StoredSession>(LS_SESSIONS).slice(0, limit);
}

/* ----------------------------------------------------------------- chunks */

export async function addChunks(
  chunks: NewChunk[],
  sessionId: string | null,
  sessionCount: number,
): Promise<void> {
  if (chunks.length === 0) return;

  const uidv = await userId();
  if (uidv) {
    const sb = supabase()!;
    const { error } = await sb.from("speak_chunks").upsert(
      chunks.map((c) => ({
        user_id: uidv,
        en: c.en,
        ko: c.ko,
        origin: c.origin,
        scenario_id: c.scenarioId ?? null,
        session_id: sessionId,
        interval_step: 0,
        due_at_session: nextDue(sessionCount, 0),
      })),
      { onConflict: "user_id,en", ignoreDuplicates: true },
    );
    if (!error) return;
  }

  const existing = readLocal<StoredChunk>(LS_CHUNKS);
  const seen = new Set(existing.map((c) => c.en.toLowerCase()));
  const fresh = chunks
    .filter((c) => !seen.has(c.en.toLowerCase()))
    .map<StoredChunk>((c) => ({
      id: uid(),
      en: c.en,
      ko: c.ko,
      origin: c.origin,
      scenarioId: c.scenarioId ?? null,
      sessionId,
      createdAt: new Date().toISOString(),
      intervalStep: 0,
      dueAtSession: nextDue(sessionCount, 0),
    }));
  writeLocal(LS_CHUNKS, [...fresh, ...existing]);
}

export async function listChunks(): Promise<StoredChunk[]> {
  const uidv = await userId();
  if (uidv) {
    const sb = supabase()!;
    const { data, error } = await sb
      .from("speak_chunks")
      .select("id, en, ko, origin, scenario_id, session_id, created_at, interval_step, due_at_session")
      .order("created_at", { ascending: false });
    if (!error && data) {
      return data.map((r) => ({
        id: r.id as string,
        en: r.en as string,
        ko: r.ko as string,
        origin: r.origin as StoredChunk["origin"],
        scenarioId: (r.scenario_id ?? null) as string | null,
        sessionId: (r.session_id ?? null) as string | null,
        createdAt: r.created_at as string,
        intervalStep: r.interval_step as number,
        dueAtSession: r.due_at_session as number,
      }));
    }
  }
  return readLocal<StoredChunk>(LS_CHUNKS);
}

/* ------------------------------------------------------------------ stats */

export async function stats(): Promise<Stats> {
  const [sessions, chunks] = await Promise.all([listSessions(200), listChunks()]);
  return {
    sessionCount: sessions.length,
    totalSpeakingMs: sessions.reduce((sum, s) => sum + s.speakingMs, 0),
    chunkCount: chunks.length,
    hesitations: sessions[0]?.hesitations ?? null,
    prevHesitations: sessions[1]?.hesitations ?? null,
  };
}
