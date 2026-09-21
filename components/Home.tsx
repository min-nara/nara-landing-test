"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SCENARIOS, TRACK_LABEL } from "@/lib/scenarios";
import { stats as loadStats } from "@/lib/store";
import type { Stats } from "@/lib/types";
import { AuthButton } from "./AuthButton";

function durationLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}분 대화` : `${m}분 ${s}초 대화`;
}

function formatSpeaking(ms: number): { n: string; unit: string } {
  const total = Math.round(ms / 1000);
  if (total < 60) return { n: String(total), unit: "초" };
  const m = Math.floor(total / 60);
  if (m < 60) return { n: `${m}`, unit: `분 ${total % 60}초` };
  return { n: `${Math.floor(m / 60)}`, unit: `시간 ${m % 60}분` };
}

export function Home({ liveMode }: { liveMode: boolean }) {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    void loadStats().then(setS);
  }, []);

  const spoken = formatSpeaking(s?.totalSpeakingMs ?? 0);
  const delta =
    s?.hesitations != null && s?.prevHesitations != null ? s.hesitations - s.prevHesitations : null;

  return (
    <>
      <div className="topbar" style={{ position: "relative" }}>
        <div className="wordmark">
          Speak<span>Time</span>
        </div>
        <div className="topbar-actions">
          <AuthButton />
        </div>
      </div>

      <section className="hero-metric">
        <div className="label">지금까지 실제로 말한 시간</div>
        <div className="value">
          {spoken.n}
          <span className="unit"> {spoken.unit}</span>
        </div>
        <div className="metric-row">
          <span className="chip">세션 {s?.sessionCount ?? 0}회</span>
          <span className="chip chip-accent">내 청크 {s?.chunkCount ?? 0}개</span>
          {delta != null && (
            <span className={delta <= 0 ? "chip chip-accent" : "chip chip-warn"}>
              막힘 {delta <= 0 ? "" : "+"}
              {delta}
            </span>
          )}
        </div>
      </section>

      {!liveMode && (
        <p className="banner banner-warn">
          목업 모드로 동작 중입니다. <b>GEMINI_API_KEY</b>를 설정하면 실제 음성 대화로 바뀝니다.
          화면 흐름은 지금도 끝까지 확인할 수 있습니다.
        </p>
      )}

      {(s?.sessionCount ?? 0) === 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="eyebrow">이 앱의 규칙</div>
          <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>
            정확하게 말하지 않아도 됩니다. <b style={{ color: "var(--fg)" }}>막히면 한국어로 말해버리세요.</b>{" "}
            그 자리에서 영어를 꽂아드리고, 그 표현은 내 청크 덱에 쌓입니다. 이 앱이 세는 건 정답이 아니라
            말한 시간입니다.
          </p>
        </div>
      )}

      {(["daily", "work"] as const).map((track) => (
        <div key={track}>
          <div className="section-head">
            <h2>{TRACK_LABEL[track]}</h2>
            <span className="faint">
              {SCENARIOS.filter((x) => x.track === track).length}개 상황
            </span>
          </div>
          {SCENARIOS.filter((x) => x.track === track).map((sc) => (
            <Link key={sc.id} href={`/session/${sc.id}`} className="scenario">
              <div className="scenario-top">
                <span className="chip">{durationLabel(sc.round1Seconds)}</span>
                <span className="chip">청크 {sc.chunks.length}</span>
              </div>
              <h3>{sc.titleKo}</h3>
              <div className="en">{sc.title}</div>
              <p>{sc.contextKo}</p>
            </Link>
          ))}
        </div>
      ))}

      <p className="faint" style={{ marginTop: 28, textAlign: "center" }}>
        주 3~4회 · 한 번에 12분이면 충분합니다.
      </p>
    </>
  );
}
