"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchTts, blobToBase64, playBlob, speak } from "@/lib/audio";
import { useRecorder } from "@/lib/useRecorder";
import { addChunks, appendRound, dueChunks, reviewChunk, saveSession, stats as loadStats } from "@/lib/store";
import type { Scenario } from "@/lib/scenarios";
import type { NewChunk, Report, Rescue, StoredChunk, StoredTurn, Transcription } from "@/lib/types";
import { MicIcon, PlayIcon } from "./Icons";

type Stage = "warmup" | "brief" | "shadow" | "round1" | "report" | "round2" | "wrap" | "done";
const STAGES: Stage[] = ["brief", "shadow", "round1", "report", "round2", "wrap"];

/** 4/3/2 — 같은 내용을 더 짧은 시간에. 시간을 줄이는 조건이 고정 조건보다 효과적이다. */
const ROUND2_RATIO = 0.7;

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

  // 워밍업 — 덱에서 인출할 차례가 된 청크. 없으면 이 단계를 건너뛴다.
  const [due, setDue] = useState<StoredChunk[] | null>(null);
  const sessionCount = useRef(0);

  // 라운드별로 따로 센다. 1차 대비 2차가 줄었는지가 이 앱의 성적표다.
  const [turns1, setTurns1] = useState<StoredTurn[]>([]);
  const [turns2, setTurns2] = useState<StoredTurn[]>([]);
  const [spoke1, setSpoke1] = useState({ ms: 0, hesitations: 0 });
  const [spoke2, setSpoke2] = useState({ ms: 0, hesitations: 0 });
  const clips1 = useRef<Blob[]>([]);
  const clips2 = useRef<Blob[]>([]);

  const [rescues, setRescues] = useState(0);
  const pendingChunks = useRef<NewChunk[]>([]);
  const sessionId = useRef<string | null>(null);

  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { sessionCount: count } = await loadStats();
        // 이번 세션은 아직 저장 전이다. 덱의 소환 시점은 '이번 세션 번호' 기준이라
        // +1 을 해야 "다음 세션에 다시"가 실제로 다음 세션이 된다.
        const upcoming = count + 1;
        const rows = await dueChunks(upcoming);
        if (!alive) return;
        sessionCount.current = upcoming;
        setDue(rows);
        if (rows.length > 0) setStage("warmup");
      } catch {
        if (alive) setDue([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const back = () => (confirm("세션을 나가면 이번 기록은 저장되지 않습니다. 나갈까요?") ? router.push("/") : null);

  const round2Seconds = Math.round(scenario.round1Seconds * ROUND2_RATIO);

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
          <i key={s} className={STAGES.indexOf(s) <= STAGES.indexOf(stage) ? "on" : ""} />
        ))}
      </div>

      {error && (
        <p className="banner banner-error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      {stage === "warmup" && due && (
        <Warmup chunks={due} sessionCount={sessionCount.current} onDone={() => setStage("brief")} />
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
            setStage("round1");
          }}
        />
      )}

      {(stage === "round1" || stage === "round2") && (
        <Roleplay
          key={stage}
          scenario={scenario}
          round={stage === "round1" ? 1 : 2}
          seconds={stage === "round1" ? scenario.round1Seconds : round2Seconds}
          turns={stage === "round1" ? turns1 : turns2}
          setTurns={stage === "round1" ? setTurns1 : setTurns2}
          onSpoke={(ms, hes) => {
            const bump = (v: { ms: number; hesitations: number }) => ({
              ms: v.ms + ms,
              hesitations: v.hesitations + hes,
            });
            if (stage === "round1") setSpoke1(bump);
            else setSpoke2(bump);
          }}
          onClip={(blob) => (stage === "round1" ? clips1 : clips2).current.push(blob)}
          onRescued={(chunk) => {
            pendingChunks.current.push(chunk);
            setRescues((v) => v + 1);
          }}
          onError={setError}
          onFinish={() => setStage(stage === "round1" ? "report" : "wrap")}
        />
      )}

      {stage === "report" && (
        <ReportView
          scenario={scenario}
          turns={turns1}
          speakingMs={spoke1.ms}
          hesitations={spoke1.hesitations}
          rescues={rescues}
          pendingChunks={pendingChunks}
          report={report}
          setReport={setReport}
          onSaved={(id) => (sessionId.current = id)}
          onError={setError}
          onNext={() => setStage("round2")}
          round2Seconds={round2Seconds}
        />
      )}

      {stage === "wrap" && (
        <Wrap
          clips1={clips1.current}
          clips2={clips2.current}
          spoke1={spoke1}
          spoke2={spoke2}
          onDone={async () => {
            if (sessionId.current) {
              await appendRound(sessionId.current, {
                speakingMs: spoke2.ms,
                hesitations: spoke2.hesitations,
                turns: turns2,
              });
            }
            setStage("done");
          }}
        />
      )}

      {stage === "done" && (
        <Done
          speakingMs={spoke1.ms + spoke2.ms}
          hesitations={spoke1.hesitations + spoke2.hesitations}
          rescues={rescues}
          chunkCount={pendingChunks.current.length}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- warmup */

/**
 * 산출형 인출. 카드를 '보고 아는' SRS가 아니라 '입으로 나와야 통과'하는 SRS다.
 * 인출 방향이 산출이어야 산출 능력이 된다.
 */
function Warmup({
  chunks,
  sessionCount,
  onDone,
}: {
  chunks: StoredChunk[];
  sessionCount: number;
  onDone: () => void;
}) {
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const rec = useRecorder();
  const chunk = chunks[i];
  const last = i === chunks.length - 1;

  const next = async (recalled: boolean) => {
    await reviewChunk(chunk.id, recalled, sessionCount);
    if (last) onDone();
    else {
      setRevealed(false);
      setI((v) => v + 1);
    }
  };

  const toggleMic = async () => {
    if (rec.state === "recording") {
      await rec.stop();
      setRevealed(true);
    } else {
      await rec.start();
    }
  };

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">워밍업 · 지난 청크 인출</div>
        <h1 className="stage-title" style={{ marginTop: 6 }}>
          보고 아는 것과 입에서 나오는 건 다릅니다
        </h1>
        <p className="stage-sub">한국어를 보고, 영어를 소리 내어 말해보세요. 눈으로 넘기면 효과가 없습니다.</p>
      </div>

      <div className="chunk-count">
        {i + 1} / {chunks.length}
      </div>

      <div className="card chunk-card">
        <div className="ko" style={{ fontSize: 17 }}>
          {chunk.ko}
        </div>
        {revealed ? (
          <div className="en" style={{ marginTop: 10 }}>
            {chunk.en}
          </div>
        ) : (
          <div className="note" style={{ marginTop: 10 }}>
            먼저 말해보고, 그다음에 확인합니다
          </div>
        )}
      </div>

      {revealed && (
        <button
          className="btn btn-ghost btn-block"
          disabled={playing}
          onClick={async () => {
            setPlaying(true);
            await speak(chunk.en, 0.85);
            setPlaying(false);
          }}
        >
          {playing ? <span className="spinner" /> : <PlayIcon />} 원어민 소리로 확인
        </button>
      )}

      {rec.error && <p className="banner banner-error">{rec.error}</p>}

      <div className="dock">
        {!revealed ? (
          <>
            <button
              className={`mic ${rec.state === "recording" ? "live" : ""}`}
              onClick={toggleMic}
              disabled={rec.state === "processing"}
              aria-label={rec.state === "recording" ? "말하기 끝" : "말하기 시작"}
            >
              {rec.state === "processing" ? <span className="spinner" /> : <MicIcon live={rec.state === "recording"} />}
            </button>
            <div className="dock-hint">
              {rec.state === "recording" ? "말이 끝나면 다시 탭" : "탭하고 영어로 말해보세요"}
            </div>
            <button className="btn btn-quiet btn-block" onClick={() => setRevealed(true)}>
              모르겠으면 바로 정답 보기
            </button>
          </>
        ) : (
          <>
            <div className="dock-hint">입에서 나왔나요? 솔직하게 고르면 다음 소환 시점이 정해집니다.</div>
            <div className="row">
              <button className="btn btn-ghost" onClick={() => next(false)}>
                못 나왔다
              </button>
              <button className="btn btn-primary" onClick={() => next(true)}>
                나왔다
              </button>
            </div>
          </>
        )}
      </div>
    </div>
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
  round,
  seconds,
  turns,
  setTurns,
  onSpoke,
  onClip,
  onRescued,
  onError,
  onFinish,
}: {
  scenario: Scenario;
  round: 1 | 2;
  seconds: number;
  turns: StoredTurn[];
  setTurns: React.Dispatch<React.SetStateAction<StoredTurn[]>>;
  onSpoke: (ms: number, hesitations: number) => void;
  onClip: (blob: Blob) => void;
  onRescued: (chunk: NewChunk) => void;
  onError: (msg: string | null) => void;
  onFinish: () => void;
}) {
  const rec = useRecorder();
  const [thinking, setThinking] = useState(false);
  const [rescue, setRescue] = useState<Rescue | null>(null);
  const [left, setLeft] = useState(seconds);
  const [spoken, setSpoken] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  // 2차는 상대도 빨라진다. 실시간 처리 부하가 있어야 자동화가 생긴다.
  const replyRate = round === 1 ? 0.92 : 1.05;

  // AI 첫 마디. 오디오는 직전 화면의 탭에서 이미 재생을 걸어 두었다.
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
          round,
          history: next.map((t) => ({ role: t.role === "ai" ? "model" : "user", text: t.text })),
        });
        setTurns([...next, { role: "ai", text: reply }]);
        void speak(reply, replyRate);
      } catch (e) {
        onError(e instanceof Error ? e.message : "상대의 답을 받지 못했습니다.");
      } finally {
        setThinking(false);
      }
    },
    [turns, setTurns, scenario.id, round, replyRate, onError],
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
    onClip(r.wav);

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
          {round === 2 && <b className="round-tag">2차</b>} 남은 시간 <b className="mono">{mmss(left)}</b>
        </div>
        <div className="t">
          내가 말한 시간 <b className="mono">{mmss(spoken / 1000)}</b>
        </div>
      </div>

      {round === 2 && turns.length <= 1 && (
        <p className="banner" style={{ marginBottom: 10 }}>
          같은 상황을 한 번 더. 시간은 30% 짧고 상대는 조금 빠릅니다. 완벽하게 말고, <b>덜 막히게</b>.
        </p>
      )}

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
          {round === 1 ? "대화 끝내고 리포트 보기" : "2차 끝내고 오늘 마무리"}
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
  onSaved,
  onError,
  onNext,
  round2Seconds,
}: {
  scenario: Scenario;
  turns: StoredTurn[];
  speakingMs: number;
  hesitations: number;
  rescues: number;
  pendingChunks: React.MutableRefObject<NewChunk[]>;
  report: Report | null;
  setReport: (r: Report) => void;
  onSaved: (id: string) => void;
  onError: (msg: string) => void;
  onNext: () => void;
  round2Seconds: number;
}) {
  const [saving, setSaving] = useState(true);
  const ran = useRef(false);

  // 2차 첫 마디를 미리 받아둔다 — 리포트를 읽는 동안 받아두면 탭 즉시 재생된다.
  const opening = useRef<Promise<Blob | null> | null>(null);
  useEffect(() => {
    opening.current = fetchTts(scenario.opening, 1.05);
  }, [scenario.opening]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        // 한 마디도 안 한 대화에 리포트를 요구하면 모델이 학습자의 말을 지어낸다.
        // 없는 발화를 인용한 교정은 피드백이 아니라 거짓말이다.
        if (!turns.some((t) => t.role === "you")) {
          setSaving(false);
          return;
        }
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
        onSaved(session.id);
        const { sessionCount } = await loadStats();
        await addChunks(pendingChunks.current, session.id, sessionCount);
      } catch (e) {
        onError(e instanceof Error ? e.message : "리포트를 만들지 못했습니다.");
      } finally {
        setSaving(false);
      }
    })();
  }, [scenario.id, turns, speakingMs, hesitations, rescues, pendingChunks, setReport, onSaved, onError]);

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

      {!report && (
        <div className="card">
          <p style={{ fontSize: 15 }}>
            이번 대화에서 말한 내용이 없어 리포트를 만들지 않았습니다. 없는 발화를 지어내 교정하는 것보다, 한 번 더
            말해보는 편이 낫습니다.
          </p>
        </div>
      )}

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
              다음 세션 워밍업에서 소리 내어 인출하게 됩니다. 눈으로 아는 것과 입으로 나오는 건 다릅니다.
            </p>
          </div>
        </>
      )}

      <div className="card">
        <div className="eyebrow">이제 한 번 더</div>
        <p style={{ marginTop: 8, fontSize: 15 }}>
          같은 상황을 <b>{mmss(round2Seconds)}</b> 안에. 방금 본 표현을 써먹어도 좋고, 안 써도 됩니다. 목표는 정확도가
          아니라 <b>덜 막히는 것</b>입니다.
        </p>
      </div>

      <button
        className="btn btn-primary btn-block"
        onClick={async () => {
          const blob = await opening.current;
          if (blob) void playBlob(blob);
          onNext();
        }}
      >
        2차 대화 시작하기
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------- wrap */

/** 1차와 2차를 나란히 듣는다. 늘었다는 걸 말로 설명하는 것보다 귀로 듣는 게 빠르다. */
function Wrap({
  clips1,
  clips2,
  spoke1,
  spoke2,
  onDone,
}: {
  clips1: Blob[];
  clips2: Blob[];
  spoke1: { ms: number; hesitations: number };
  spoke2: { ms: number; hesitations: number };
  onDone: () => void;
}) {
  const [playing, setPlaying] = useState<null | 1 | 2>(null);
  const [busy, setBusy] = useState(false);

  const play = async (which: 1 | 2) => {
    const clips = which === 1 ? clips1 : clips2;
    if (clips.length === 0) return;
    setPlaying(which);
    for (const clip of clips) await playBlob(clip);
    setPlaying(null);
  };

  const delta = spoke1.hesitations - spoke2.hesitations;

  return (
    <div className="stack">
      <div>
        <div className="eyebrow">마무리</div>
        <h1 className="stage-title" style={{ marginTop: 6 }}>
          1차와 2차, 직접 들어보세요
        </h1>
        <p className="stage-sub">같은 상황을 두 번 말했습니다. 달라진 건 대개 내용이 아니라 흐름입니다.</p>
      </div>

      <div className="compare">
        {([1, 2] as const).map((which) => {
          const spoke = which === 1 ? spoke1 : spoke2;
          const clips = which === 1 ? clips1 : clips2;
          return (
            <div key={which} className="card compare-col">
              <div className="eyebrow">{which}차</div>
              <div className="compare-metric mono">{mmss(spoke.ms / 1000)}</div>
              <div className="faint">말한 시간</div>
              <div className="compare-metric mono" style={{ marginTop: 10 }}>
                {spoke.hesitations}
              </div>
              <div className="faint">막힘</div>
              <button
                className="btn btn-ghost btn-block"
                style={{ marginTop: 12 }}
                disabled={clips.length === 0 || playing !== null}
                onClick={() => play(which)}
              >
                {playing === which ? <span className="spinner" /> : <PlayIcon />}
                {clips.length === 0 ? "녹음 없음" : `내 소리 ${clips.length}개`}
              </button>
            </div>
          );
        })}
      </div>

      <div className="card">
        <p style={{ fontSize: 15 }}>
          {delta > 0
            ? `2차에서 막힘이 ${delta}회 줄었습니다. 같은 내용을 짧은 시간에 다시 말하면 이렇게 됩니다.`
            : delta === 0
              ? "막힘 횟수는 같았습니다. 한 번에 안 바뀝니다 — 이 훈련은 누적으로 효과가 납니다."
              : "2차에서 막힘이 늘었습니다. 시간을 줄였으니 당연한 결과일 수 있습니다. 내용을 더 밀어붙였다면 잘하신 겁니다."}
        </p>
      </div>

      <button
        className="btn btn-primary btn-block"
        disabled={busy || playing !== null}
        onClick={async () => {
          setBusy(true);
          await onDone();
        }}
      >
        {busy ? <span className="spinner" /> : null} 오늘 기록 보기
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
