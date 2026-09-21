"use client";

import { useCallback, useRef, useState } from "react";
import { blobToWav, pickMimeType } from "./audio";

export type Recording = { wav: Blob; ms: number };

export type RecorderState = "idle" | "recording" | "processing";

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      const mimeType = pickMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      mr.start();
      recorder.current = mr;
      startedAt.current = Date.now();
      setState("recording");
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "마이크 권한이 필요합니다. 브라우저 설정에서 허용해주세요."
          : "마이크를 열 수 없습니다.",
      );
      setState("idle");
    }
  }, []);

  const stop = useCallback(async (): Promise<Recording | null> => {
    const mr = recorder.current;
    if (!mr || mr.state === "inactive") return null;
    setState("processing");
    const ms = Date.now() - startedAt.current;

    const raw = await new Promise<Blob>((resolve) => {
      mr.onstop = () => resolve(new Blob(chunks.current, { type: mr.mimeType || "audio/webm" }));
      mr.stop();
    });
    mr.stream.getTracks().forEach((t) => t.stop());
    recorder.current = null;

    try {
      const wav = await blobToWav(raw);
      setState("idle");
      return { wav, ms };
    } catch {
      setError("녹음을 변환하지 못했습니다. 다시 시도해주세요.");
      setState("idle");
      return null;
    }
  }, []);

  return { state, error, start, stop };
}
