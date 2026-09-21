"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchTts, blobToBase64, playBlob, speak } from "@/lib/audio";
import { useRecorder } from "@/lib/useRecorder";
import { addChunks, saveSession, stats as loadStats } from "@/lib/store";
import type { Scenario } from "@/lib/scenarios";
import type { NewChunk, Report, Rescue, StoredTurn, Transcription } from "@/lib/types";
import { MicIcon, PlayIcon } from "./Icons";

type Stage = "brief" | "shadow" | "roleplay" | "report" | "done";
const STAGES: Stage[] = ["brief", "shadow", "roleplay", "report"];

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `${url} failed`);
  return json as T;
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Session({ scenario }: { scenario: Scenario }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("brief");
  const [error, setError] = useState<string | null>(null);

  // 누적 지표
  const [turns, setTurns] = useState<StoredTurn[]>([]);
  const [speakingMs, setSpeakingMs] = useState(0);
  const [hesitations, setHesitations] = useState(0);
  const [rescues, setRescues] = useState(0);
  const pendingChunks = useRef<NewChunk[]>([]);

  const [report, setReport] = useState<Report | null>(null);

  const back = () => (confirm("세션을 나가면 이번 기록은 저장되지 않습니다. 나갈까요?") ? router.push("/") : null);

  return (
    <>
      <div className="topbar">
        <button className="btn btn-quiet" onClick={back}>
          ← 나가기
        </button>
        <div className="faint">{scenario.titleKo}</div>
      </div>

      <div className="progress-rail">
        {STAGES.map((s) => (
          <i key={s} className={STAGES.indexOf(s) <= STAGES.indexOf(stage as Stage) ? "on" : ""} />
        ))}
      </div>

      {error && (
        <p className="banner banner-error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      {stage === "brief" && <Brief scenario={scenario} onNext={() => setStage("shadow")} />}

      {stage === "shadow" && (
        <Shadow
          scenario={scenario}
          onDone={() => {
            pendingChunks.current.push(
              ...scenario.chunks.map((c) => ({
                en: c.en,
                ko: c.ko,
                origin: "scenario" as const,
                scenarioId: scenario.id,
              })),
            );
            setStage("roleplay");
          }}
        />
      )}

      {stage === "roleplay" && (
        <Roleplay
          scenario={scenario}
          turns={turns}
          setTurns={setTurns}
          onSpoke={(ms, hes) => {
            setSpeakingMs((v) => v + ms);
            setHesitations((v) => v + hes);
          }}
          onRescued={(chunk) => {
            pendingChunks.current.push(chunk);
            setRescues((v) => v + 1);
          }}
          onError={setError}
          onFinish={() => setStage("report")}
        />
      )}

      {stage === "report" && (
        <ReportView
          scenario={scenario}
          turns={turns}
          speakingMs={speakingMs}
          hesitations={hesitations}
          rescues={rescues}
          pendingChunks={pendingChunks}
          report={report}
          setReport={setReport}
          onError={setError}
          onDone={() => setStage("done")}
        />
      )}

      {stage === "done" && (
        <Done speakingMs={speakingMs} hesitations={hesitations} rescues={rescues} chunkCount={pendingChunks.current.length} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ brief */

function Brief({ scenario, onNext }: { scenario: Scenario; onNext: () => void }) {
  const [playing, setPlaying] = useState(false);
  const [showKo, setShowKo] = useState(false);

  const listen = async () => {
    setPlaying(true);
    for (const line of scenario.modelDialogue) {
      await speak(line.text, 0.9);
    }
    setPlaying(false);
  };

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">상황</div>
        <h1 className="stage-title" style={{ marginTop: 6 }}>
          {scenario.titleKo}
        </h1>
        <p className="stage-sub">{scenario.contextKo}</p>
        <div className="goal">
          <b>오늘의 목표</b> · {scenario.goalKo}
        </div>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div className="eyebrow">이렇게 굴러갑니다</div>
          <button className="btn btn-quiet" onClick={() => setShowKo((v) => !v)}>
            {showKo ? "해석 숨기기" : "해석 보기"}
          </button>
        </div>
        {scenario.modelDialogue.map((line, i) => (
          <div key={i} className={`line ${line.speaker}`}>
            <div className="who">{line.speaker === "ai" ? "상대" : "나"}</div>
            <div>
              <div className="en">{line.text}</div>
              {showKo && <div className="ko">{line.ko}</div>}
            </div>
          </div>
        ))}
        <button className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={listen} disabled={playing}>
          {playing ? <span className="spinner" /> : <PlayIcon />}
          {playing ? "재생 중" : "소리로 듣기"}
        </button>
      </div>

      <button className="btn btn-primary btn-block" onClick={onNext}>
        청크 연습으로
      </button>
    </div>
  );
}

/* ----------------------------------------------------------------- shadow */

function Shadow({ scenario, onDone }: { scenario: Scenario; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mine, setMine] = useState<Blob | null>(null);
  const rec = useRecorder();
  const chunk = scenario.chunks[i];
  const last = i === scenario.chunks.length - 1;

  // 롤플레이 첫 마디를 미리 받아둔다 — 탭 없이는 재생이 막히는 브라우저 대비.
  const opening = useRef<Promise<Blob | null> | null>(null);
  useEffect(() => {
    opening.current = fetchTts(scenario.opening, 0.9);
  }, [scenario.opening]);

  const toggleMic = async () => {
    if (rec.state === "recording") {
      const r = await rec.stop();
      if (r) setMine(r.wav);
    } else {
      setMine(null);
      await rec.start();
    }
  };

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">따라 말하기</div>
        <h1 className="stage-title" style={{ marginTop: 6 }}>
          덩어리로 외워야 빨리 나옵니다
        </h1>
        <p className="stage-sub">단어를 조합하면 늦습니다. 통째로 입에 붙이세요.</p>
      </div>

      <div className="chunk-count">
        {i + 1} / {scenario.chunks.length}
      </div>

      <div className="card chunk-card">
        <div className="en">{chunk.en}</div>
        <div className="ko">{chunk.ko}</div>
        <div className="note">{chunk.note}</div>
      </div>

      <div className="row">
        <button
          className="btn btn-ghost"
          disabled={playing || rec.state === "recording"}
          onClick={async () => {
            setPlaying(true);
            await speak(chunk.en, 0.85);
            setPlaying(false);
          }}
        >
          {playing ? <span className="spinner" /> : <PlayIcon />} 듣기
        </button>
        <button className="btn btn-ghost" disabled={!mine} onClick={() => mine && playBlob(mine)}>
          <PlayIcon /> 내 소리
        </button>
      </div>

      {rec.error && <p className="banner banner-error">{rec.error}</p>}

      <div className="dock">
        <button
          className={`mic ${rec.state === "recording" ? "live" : ""}`}
          onClick={toggleMic}
          disabled={rec.state === "processing" || playing}
          aria-label={rec.state === "recording" ? "녹음 중지" : "따라 말하기 녹음"}
        >
          {rec.state === "processing" ? <span className="spinner" /> : <MicIcon live={rec.state === "recording"} />}
        </button>
        <div className="dock-hint">
          {rec.state === "recording" ? "듣고 있습니다 — 끝나면 다시 탭" : mine ? "좋습니다. 다음으로." : "탭하고 따라 말하세요"}
        </div>
        <button
          className="btn btn-primary btn-block"
          disabled={rec.state === "recording"}
          onClick={async () => {
            if (last) {
              // 첫 마디 오디오는 이 탭 제스처 안에서 재생해야 모바일에서 막히지 않는다.
              const blob = await opening.current;
              if (blob) void playBlob(blob);
              onDone();
            } else {
              setMine(null);
              setI((v) => v + 1);
            }
          }}
        >
          {last ? "대화 시작하기" : "다음 청크"}
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- roleplay */

function Roleplay({
  scenario,
  turns,
  setTurns,
  onSpoke,
  onRescued,
  onError,
  onFinish,
}: {
  scenario: Scenario;
  turns: StoredTurn[];
  setTurns: React.Dispatch<React.SetStateAction<StoredTurn[]>>;
  onSpoke: (ms: number, hesitations: number) => void;
  onRescued: (chunk: NewChunk) => void;
  onError: (msg: string | null) => void;
  onFinish: () => void;
}) {
  const rec = useRecorder();
  const [thinking, setThinking] = useState(false);
  const [rescue, setRescue] = useState<Rescue | null>(null);
  const [left, setLeft] = useState(scenario.round1Seconds);
  const [spoken, setSpoken] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  // AI 첫 마디. 오디오는 직전 탭에서 이미 재생을 걸어 두었다.
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setTurns([{ role: "ai", text: scenario.opening }]);
  }, [scenario.opening, setTurns]);

  useEffect(() => {
    const t = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, rescue, thinking]);

  const advance = useCallback(
    async (userText: string, ms: number, rescued: boolean) => {
      const next: StoredTurn[] = [...turns, { role: "you", text: userText, ms, rescued }];
      setTurns(next);
      setThinking(true);
      try {
        const { reply } = await postJson<{ reply: string }>("/api/chat", {
          scenarioId: scenario.id,
          round: 1,
          history: next.map((t) => ({ role: t.role === "ai" ? "model" : "user", text: t.text })),
        });
        setTurns([...next, { role: "ai", text: reply }]);
        void speak(reply, 0.92);
      } catch (e) {
        onError(e instanceof Error ? e.message : "상대의 답을 받지 못했습니다.");
      } finally {
        setThinking(false);
      }
    },
    [turns, setTurns, scenario.id, onError],
  );

  const toggleMic = async () => {
    if (rec.state !== "recording") {
      onError(null);
      await rec.start();
      return;
    }

    const r = await rec.stop();
    if (!r) return;
    setSpoken((v) => v + r.ms);
    onSpoke(r.ms, 0);

    // 구조대가 떠 있으면 사용자는 주어진 문장을 읽는 중이다. 받아쓸 필요가 없다.
    if (rescue) {
      setRescue(null);
      await advance(rescue.english, r.ms, true);
      return;
    }

    setThinking(true);
    try {
      const t = await postJson<Transcription>("/api/stt", {
        audio: await blobToBase64(r.wav),
        mimeType: "audio/wav",
      });
      onSpoke(0, t.fillers + t.longPauses);

      if (t.koreanSpans.length > 0) {
        const got = await postJson<Rescue>("/api/rescue", {
          korean: t.koreanSpans.join(" / "),
          context: turns.slice(-4).map((x) => `${x.role}: ${x.text}`).join("\n"),
        });
        setRescue(got);
        onRescued({ en: got.chunk, ko: got.chunkKo, origin: "rescue", scenarioId: scenario.id });
        void speak(got.english, 0.85);
        setThinking(false);
        return;
      }

      if (!t.text.trim()) {
        onError("소리가 잡히지 않았습니다. 다시 말해주세요.");
        setThinking(false);
        return;
      }
      await advance(t.text, r.ms, false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "받아쓰기에 실패했습니다.");
      setThinking(false);
    }
  };

  const timeUp = left === 0;

  return (
    <>
      <div className="hud">
        <div className="t">
          남은 시간 <b className="mono">{mmss(left)}</b>
        </div>
        <div className="t">
          내가 말한 시간 <b className="mono">{mmss(spoken / 1000)}</b>
        </div>
      </div>

      <div className="convo">
        {turns.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            {t.role === "ai" && <span className="tag">{scenario.aiRole}</span>}
            {t.rescued && <span className="tag">한국어 구조대로 건진 문장</span>}
            {t.text}
          </div>
        ))}
        {thinking && <div className="thinking">…</div>}
        {rescue && (
          <div className="rescue">
            <div className="head">이렇게 말하면 됩니다</div>
            <div className="en">{rescue.english}</div>
            <div className="keep">
              덱에 담았습니다 · <b>{rescue.chunk}</b> — {rescue.chunkKo}
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      {rec.error && <p className="banner banner-error">{rec.error}</p>}

      <div className="dock">
        <button
          className={`mic ${rec.state === "recording" ? "live" : ""}`}
          onClick={toggleMic}
          disabled={thinking || rec.state === "processing"}
          aria-label={rec.state === "recording" ? "말하기 끝" : "말하기 시작"}
        >
          {rec.state === "processing" || thinking ? (
            <span className="spinner" />
          ) : (
            <MicIcon live={rec.state === "recording"} />
          )}
        </button>
        <div className="dock-hint">
          {rescue
            ? "위 문장을 소리 내어 따라 말하고 탭하세요"
            : rec.state === "recording"
              ? "말이 끝나면 다시 탭"
              : timeUp
                ? "시간이 다 됐습니다. 마무리해도 좋습니다."
                : "막히면 한국어로 말해도 됩니다"}
        </div>
        <button className="btn btn-ghost btn-block" disabled={rec.state === "recording"} onClick={onFinish}>
          대화 끝내고 리포트 보기
        </button>
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- report */

function ReportView({
  scenario,
  turns,
  speakingMs,
  hesitations,
  rescues,
  pendingChunks,
  report,
  setReport,
  onError,
  onDone,
}: {
  scenario: Scenario;
  turns: StoredTurn[];
  speakingMs: number;
  hesitations: number;
  rescues: number;
  pendingChunks: React.MutableRefObject<NewChunk[]>;
  report: Report | null;
  setReport: (r: Report) => void;
  onError: (msg: string) => void;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const r = await postJson<Report>("/api/report", { scenarioId: scenario.id, turns });
        setReport(r);
        pendingChunks.current.push(
          ...r.newChunks.map((c) => ({ en: c.en, ko: c.ko, origin: "feedback" as const, scenarioId: scenario.id })),
        );
        const session = await saveSession({
          scenarioId: scenario.id,
          speakingMs,
          hesitations,
          rescues,
          turns,
          report: r,
        });
        const { sessionCount } = await loadStats();
        await addChunks(pendingChunks.current, session.id, sessionCount);
      } catch (e) {
        onError(e instanceof Error ? e.message : "리포트를 만들지 못했습니다.");
      } finally {
        setSaving(false);
      }
    })();
  }, [scenario.id, turns, speakingMs, hesitations, rescues, pendingChunks, setReport, onError]);

  if (saving && !report) {
    return (
      <div className="card center" style={{ padding: 40 }}>
        <span className="spinner" />
        <p className="muted" style={{ marginTop: 12 }}>
          방금 대화를 뜯어보는 중입니다…
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">리포트</div>
        <h1 className="stage-title" style={{ marginTop: 6 }}>
          대화 중엔 안 끊었습니다. 이제 봅시다.
        </h1>
      </div>

      {report && (
        <>
          <div className="card">
            <div className="eyebrow">잘한 것</div>
            <p style={{ marginTop: 8, fontSize: 15 }}>{report.goodKo}</p>
          </div>

          <div className="card">
            <div className="eyebrow">이렇게 말했으면 더 좋았습니다</div>
            {report.upgrades.map((u, i) => (
              <div key={i} className="upgrade">
                <div className="said">{u.said}</div>
                <div className="better">{u.better}</div>
                <div className="why">{u.whyKo}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="eyebrow">내 청크 덱에 추가됨</div>
            <div style={{ marginTop: 6 }}>
              {pendingChunks.current.map((c, i) => (
                <div key={i} className="deck-item">
                  <div>
                    <div className="en">{c.en}</div>
                    <div className="ko">{c.ko}</div>
                  </div>
                  <span className="chip">
                    {c.origin === "rescue" ? "구조대" : c.origin === "feedback" ? "피드백" : "상황"}
                  </span>
                </div>
              ))}
            </div>
            <p className="faint" style={{ marginTop: 12 }}>
              다음 세션에서 소리 내어 인출하게 됩니다. 눈으로 아는 것과 입으로 나오는 건 다릅니다.
            </p>
          </div>
        </>
      )}

      <button className="btn btn-primary btn-block" onClick={onDone}>
        오늘 기록 보기
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------- done */

function Done({
  speakingMs,
  hesitations,
  rescues,
  chunkCount,
}: {
  speakingMs: number;
  hesitations: number;
  rescues: number;
  chunkCount: number;
}) {
  return (
    <div className="stack">
      <div className="center" style={{ padding: "18px 0 4px" }}>
        <div className="eyebrow">오늘</div>
        <div className="hero-metric" style={{ padding: "8px 0 0" }}>
          <div className="value">
            {mmss(speakingMs / 1000)}
            <span className="unit"> 말했습니다</span>
          </div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{hesitations}</div>
          <div className="k">막힘</div>
        </div>
        <div className="stat">
          <div className="n">{rescues}</div>
          <div className="k">한국어 구조대</div>
        </div>
        <div className="stat">
          <div className="n">{chunkCount}</div>
          <div className="k">새 청크</div>
        </div>
      </div>

      <p className="faint center" style={{ marginTop: 6 }}>
        막힘은 줄이면 되고, 구조대는 쓸수록 덱이 두꺼워집니다. 둘 다 정상입니다.
      </p>

      <a className="btn btn-primary btn-block" href="/">
        홈으로
      </a>
    </div>
  );
}
