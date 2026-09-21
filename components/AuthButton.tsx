"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

/**
 * 로그인은 선택이다. 안 해도 기록은 이 기기에 남는다.
 * 로그인하면 기기를 바꿔도 청크 덱이 따라온다.
 */
export function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    void sb.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) =>
      setEmail(session?.user?.email ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return null;

  if (email) {
    return (
      <button
        className="btn btn-quiet"
        onClick={async () => {
          await supabase()?.auth.signOut();
          location.reload();
        }}
      >
        {email.split("@")[0]} · 로그아웃
      </button>
    );
  }

  if (!open) {
    return (
      <button className="btn btn-quiet" onClick={() => setOpen(true)}>
        기록 동기화
      </button>
    );
  }

  return (
    <div className="card" style={{ position: "absolute", right: 20, top: 56, zIndex: 20, width: "min(320px, calc(100vw - 40px))" }}>
      {sent ? (
        <p className="faint">메일함을 확인하세요. 링크를 누르면 로그인됩니다.</p>
      ) : (
        <>
          <p className="faint" style={{ marginBottom: 10 }}>
            기기를 바꿔도 청크 덱이 따라오게 하려면 로그인하세요. 안 해도 이 기기에는 기록됩니다.
          </p>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{
              width: "100%",
              padding: "11px 13px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--bg)",
              color: "var(--fg)",
              fontSize: 15,
            }}
          />
          {error && <p className="banner banner-error" style={{ marginTop: 10 }}>{error}</p>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-ghost" onClick={() => setOpen(false)}>
              닫기
            </button>
            <button
              className="btn btn-primary"
              disabled={!input.includes("@")}
              onClick={async () => {
                setError(null);
                const { error } = await supabase()!.auth.signInWithOtp({
                  email: input,
                  options: { emailRedirectTo: location.origin },
                });
                if (error) setError(error.message);
                else setSent(true);
              }}
            >
              링크 받기
            </button>
          </div>
        </>
      )}
    </div>
  );
}
