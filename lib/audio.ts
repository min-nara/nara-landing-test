"use client";

/**
 * 녹음 포맷은 브라우저마다 다르다 — Chrome은 webm/opus, iOS Safari는 mp4/aac.
 * Gemini가 확실히 받는 포맷으로 맞추기 위해, 녹음물을 브라우저에서 디코드해
 * 16kHz 모노 WAV로 다시 인코딩한 뒤 보낸다. 컨테이너 변수를 전부 없애준다.
 */

const TARGET_RATE = 16000;

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export async function blobToWav(blob: Blob): Promise<Blob> {
  const Ctx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = downmix(decoded);
    const resampled = decoded.sampleRate === TARGET_RATE ? mono : resample(mono, decoded.sampleRate, TARGET_RATE);
    return new Blob([encodeWav(resampled, TARGET_RATE)], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

function downmix(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < buf.length; i++) out[i] += data[i] / buf.numberOfChannels;
  }
  return out;
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    out[i] = input[lo] + (input[hi] - input[lo]) * (pos - lo);
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}

/** 순차 재생용 — 앞의 재생이 끝나야 다음으로 넘어간다. */
export function playBlob(blob: Blob): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    const done = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onended = done;
    audio.onerror = done;
    void audio.play().catch(done);
  });
}

/**
 * 모바일 브라우저는 사용자 탭과 무관한 재생을 막는다. 그래서 오디오를 미리
 * 받아두고(fetchTts), 탭 핸들러 안에서 바로 재생(playBlob)할 수 있게 나눠 둔다.
 */
export async function fetchTts(text: string, rate = 1): Promise<Blob | null> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, rate }),
    });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

export async function speak(text: string, rate = 1): Promise<void> {
  const blob = await fetchTts(text, rate);
  // 음성이 실패해도 대화는 계속되어야 한다.
  if (blob) await playBlob(blob);
}
