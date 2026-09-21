import type { Report } from "./gemini";

export type { Report, ReportUpgrade, Transcription, Rescue } from "./gemini";

export type StoredTurn = {
  role: "ai" | "you";
  text: string;
  /** 'you' 턴에서 실제 발화 길이 */
  ms?: number;
  /** 한국어 구조대로 건져낸 턴인지 */
  rescued?: boolean;
};

export type StoredSession = {
  id: string;
  scenarioId: string;
  createdAt: string;
  speakingMs: number;
  hesitations: number;
  rescues: number;
  turns: StoredTurn[];
  report: Report | null;
};

export type ChunkOrigin = "scenario" | "rescue" | "feedback";

export type StoredChunk = {
  id: string;
  en: string;
  ko: string;
  origin: ChunkOrigin;
  scenarioId: string | null;
  sessionId: string | null;
  createdAt: string;
  intervalStep: number;
  dueAtSession: number;
};

export type NewChunk = {
  en: string;
  ko: string;
  origin: ChunkOrigin;
  scenarioId?: string | null;
};

export type Stats = {
  sessionCount: number;
  totalSpeakingMs: number;
  chunkCount: number;
  /** 최근 세션의 막힘 횟수와 그 직전 세션의 막힘 횟수 */
  hesitations: number | null;
  prevHesitations: number | null;
};
