/**
 * Google AI Studio (Gemini) 래퍼.
 *
 * 모델 이름은 자주 바뀌므로 하드코딩하지 않는다. 기동 시 /models 를 한 번 조회해
 * 선호 목록 중 실제로 존재하는 첫 모델을 고른다. 키가 없으면 전 구간 목업으로 동작해
 * 키 없이도 화면 흐름을 끝까지 확인할 수 있다.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export type Role = "user" | "model";
export type Turn = { role: Role; text: string };

export function hasKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

function key(): string {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY is not set");
  return k;
}

/* ------------------------------------------------------------------ models */

const PREFERRED = {
  // -latest 별칭은 풀이 붐벼 503 이 잦다. 구체 버전을 먼저 두고 별칭은 뒤로 뺀다.
  chat: ["gemini-3.6-flash", "gemini-3-flash", "gemini-flash-latest", "gemini-2.5-flash"],
  // 전사 전용 모델이 1순위 — 범용 모델보다 혼잡이 덜하다. JSON 모드를 거부하면
  // generateJson 이 프롬프트 모드로 알아서 물러선다.
  stt: ["gemini-3.5-transcribe", "gemini-3.6-flash", "gemini-3-flash", "gemini-flash-latest"],
  tts: [
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-tts",
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro-tts",
  ],
} as const;

const ENV_OVERRIDE: Record<keyof typeof PREFERRED, string | undefined> = {
  chat: process.env.GEMINI_CHAT_MODEL,
  stt: process.env.GEMINI_STT_MODEL,
  tts: process.env.GEMINI_TTS_MODEL,
};

let modelCache: Promise<Set<string>> | null = null;

async function availableModels(): Promise<Set<string>> {
  if (!modelCache) {
    modelCache = (async () => {
      const res = await fetch(`${BASE}/models?key=${key()}&pageSize=200`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`model list failed: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { models?: { name: string }[] };
      return new Set((json.models ?? []).map((m) => m.name.replace(/^models\//, "")));
    })().catch((e) => {
      modelCache = null;
      throw e;
    });
  }
  return modelCache;
}

export async function resolveModel(kind: keyof typeof PREFERRED): Promise<string> {
  const override = ENV_OVERRIDE[kind];
  if (override) return override;
  const available = await availableModels();
  const hit = PREFERRED[kind].find((m) => available.has(m));
  if (hit) return hit;
  // 선호 목록이 전부 빗나가면 이름 패턴으로 한 번 더 시도한다.
  const pattern = kind === "tts" ? /tts/ : kind === "stt" ? /transcribe|flash/ : /flash/;
  const fallback = [...available].filter((m) => pattern.test(m)).sort()[0];
  if (fallback) return fallback;
  throw new Error(`no usable ${kind} model found`);
}

export async function listModels(): Promise<string[]> {
  return [...(await availableModels())].sort();
}

/* -------------------------------------------------------------- generation */

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

async function generate(
  model: string,
  body: Record<string, unknown>,
): Promise<{ parts: Part[]; finishReason?: string }> {
  // 429/5xx 는 "지금 붐빈다"는 뜻이라 대개 곧 풀린다. 대화 중에 한 번 삐끗했다고
  // 세션을 끊어버리면 안 되므로 짧게 물러섰다가 다시 친다.
  let res: Response | null = null;
  let lastBody = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${BASE}/models/${model}:generateContent?key=${key()}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (res.ok) break;
    lastBody = (await res.text()).slice(0, 400);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 2) {
      throw new Error(`gemini ${model} failed: ${res.status} ${lastBody}`);
    }
    console.warn(`[gemini] ${model} ${res.status}, 재시도 ${attempt + 1}/2`);
    await new Promise((r) => setTimeout(r, 600 * 2 ** attempt + Math.random() * 300));
  }
  if (!res || !res.ok) {
    throw new Error(`gemini ${model} failed: ${res?.status ?? "no response"} ${lastBody}`);
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  };
  const candidate = json.candidates?.[0];
  // finishReason 을 버리면 잘린 응답을 정상 응답과 구분할 수 없다.
  if (candidate?.finishReason && candidate.finishReason !== "STOP") {
    console.warn(`[gemini] ${model} finishReason=${candidate.finishReason}`);
  }
  return { parts: candidate?.content?.parts ?? [], finishReason: candidate?.finishReason };
}

function textOf(parts: Part[]): string {
  return parts
    .map((p) => ("text" in p ? p.text : ""))
    .join("")
    .trim();
}

function parseJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

/**
 * 일부 모델은 responseMimeType: application/json 을 거부한다(400).
 * 그때는 JSON 모드를 빼고 프롬프트만으로 다시 친다 — parseJson 이 코드펜스도 벗겨낸다.
 */
async function generateJson(model: string, body: Record<string, unknown>) {
  try {
    return await generate(model, body);
  } catch (e) {
    if (!(e instanceof Error) || !/JSON mode is not enabled/i.test(e.message)) throw e;
    const gc = { ...((body.generationConfig as Record<string, unknown>) ?? {}) };
    delete gc.responseMimeType;
    console.warn(`[gemini] ${model} JSON 모드 미지원 — 프롬프트 모드로 재시도`);
    return generate(model, { ...body, generationConfig: gc });
  }
}

/* --------------------------------------------------------------------- STT */

/** 막힌 지점 하나. 횟수만 세면 "어디서" 막히는지는 영영 알 수 없다. */
export type Stall = {
  /** 막히기 직전까지 말한 것 */
  before: string;
  /** 막힘을 뚫고 이어서 나온 말 */
  after: string;
  kind: "pause" | "filler";
};

export type Transcription = {
  text: string;
  /** 말 사이 1.5초 이상 멈춤 횟수 */
  longPauses: number;
  /** um, uh, 어…, 음… 같은 채움말 */
  fillers: number;
  /** 한국어로 말해버린 구간 (한국어 구조대 트리거) */
  koreanSpans: string[];
  /** 멈춤·채움말이 발생한 자리 (히트맵 재료) */
  stalls: Stall[];
};

const STT_PROMPT = `You transcribe a language learner's spoken English.

Return ONLY JSON matching this shape:
{"text": string, "longPauses": number, "fillers": number, "koreanSpans": string[],
 "stalls": [{"before": string, "after": string, "kind": "pause" | "filler"}]}

Rules:
- "text": verbatim transcript. Keep filler words (um, uh, er). If the speaker
  switched to Korean, transcribe that part in Korean, inline.
- "longPauses": how many silences longer than about 1.5 seconds occurred
  in the middle of speech (do not count leading or trailing silence).
- "fillers": total count of hesitation sounds (um, uh, er, hmm, 어, 음).
- "koreanSpans": each stretch the speaker said in Korean instead of English,
  as separate strings. Empty array if they spoke only English.
- "stalls": one entry per long pause or filler, in the order they occurred.
  "before" is the last three or four words spoken before the stall; "after" is
  the first three or four words that followed it. Leave "after" empty if the
  speaker stopped there. This is what shows the learner where their sentences
  break down, so be precise about the surrounding words.
- If the audio has no discernible speech, return text as an empty string.`;

export async function transcribe(audioBase64: string, mimeType: string): Promise<Transcription> {
  if (!hasKey()) return mockTranscription();
  const model = await resolveModel("stt");
  const { parts } = await generateJson(model, {
    contents: [
      {
        role: "user",
        parts: [{ text: STT_PROMPT }, { inlineData: { mimeType, data: audioBase64 } }],
      },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const raw = textOf(parts);
  try {
    const parsed = parseJson<Partial<Transcription>>(raw);
    return {
      text: (parsed.text ?? "").trim(),
      longPauses: Number(parsed.longPauses ?? 0) || 0,
      fillers: Number(parsed.fillers ?? 0) || 0,
      koreanSpans: Array.isArray(parsed.koreanSpans) ? parsed.koreanSpans.filter(Boolean) : [],
      stalls: Array.isArray(parsed.stalls)
        ? parsed.stalls
            .filter((x): x is Stall => !!x && typeof x.before === "string")
            .map((x) => ({
              before: x.before.trim(),
              after: (x.after ?? "").trim(),
              kind: x.kind === "filler" ? "filler" : "pause",
            }))
        : [],
    };
  } catch {
    // JSON이 깨지면 받아쓰기라도 살린다.
    return { text: raw, longPauses: 0, fillers: 0, koreanSpans: [], stalls: [] };
  }
}

/* -------------------------------------------------------------------- chat */

export async function chatTurn(system: string, history: Turn[]): Promise<string> {
  if (!hasKey()) return mockReply(history);
  const model = await resolveModel("chat");
  const { parts } = await generate(model, {
    systemInstruction: { parts: [{ text: system }] },
    contents: history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    generationConfig: {
      temperature: 0.9,
      // 3.x 계열은 thinking 토큰도 이 예산에서 깎는다. 대화 턴에 추론은 필요 없고,
      // 오히려 응답이 늦어져 대화가 끊긴다. 꺼두고 예산도 넉넉히 준다.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 400,
    },
  });
  return textOf(parts) || "Sorry, say that again?";
}

/* ------------------------------------------------------------------ rescue */

export type Rescue = {
  /** 사용자가 한국어로 말한 것의 영어 표현 */
  english: string;
  /** 덱에 넣을 재사용 가능한 청크 */
  chunk: string;
  chunkKo: string;
};

export async function rescueKorean(korean: string, context: string): Promise<Rescue> {
  if (!hasKey()) {
    return {
      english: `(mock) How would I say: ${korean}`,
      chunk: "(mock) I'd put it this way",
      chunkKo: "(목업) 이렇게 말하면 돼요",
    };
  }
  const model = await resolveModel("chat");
  const { parts } = await generate(model, {
    systemInstruction: {
      parts: [
        {
          text: `A Korean learner is mid-conversation and could not say something in English,
so they said it in Korean. Give them the English they were reaching for.

Return ONLY JSON: {"english": string, "chunk": string, "chunkKo": string}
- "english": the full natural sentence they should have said, in the register
  the conversation calls for. Spoken English, not written.
- "chunk": the single most reusable fragment from it (3-6 words), the part
  worth drilling. Use "~" for the slot, e.g. "I'd rather not ~".
- "chunkKo": that fragment's Korean gloss.`,
        },
      ],
    },
    contents: [
      { role: "user", parts: [{ text: `Conversation so far:\n${context}\n\nThey wanted to say (Korean): ${korean}` }] },
    ],
    generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
  });
  return parseJson<Rescue>(textOf(parts));
}

/* ------------------------------------------------------------------ report */

export type ReportUpgrade = {
  /** 사용자가 실제로 말한 것 */
  said: string;
  /** 더 나은 표현 */
  better: string;
  /** 왜 더 나은지 — 한국어로, 한 문장 */
  whyKo: string;
};

export type Report = {
  /** 잘한 점 한 줄 (한국어) */
  goodKo: string;
  upgrades: ReportUpgrade[];
  /** 이번 대화에서 덱에 추가할 청크 */
  newChunks: { en: string; ko: string }[];
};

export async function buildReport(
  scenarioTitle: string,
  goalKo: string,
  transcript: string,
): Promise<Report> {
  if (!hasKey()) return mockReport();
  const model = await resolveModel("chat");
  const { parts } = await generate(model, {
    systemInstruction: {
      parts: [
        {
          text: `You coach Korean learners on spoken English. You just watched a roleplay.

Feedback must be EXPLICIT, not a gentle recast: name the exact phrase the learner
used and the exact phrase to use instead. Research shows explicit correction after
the conversation works; hinting during it does not.

Return ONLY JSON:
{"goodKo": string,
 "upgrades": [{"said": string, "better": string, "whyKo": string}],
 "newChunks": [{"en": string, "ko": string}]}

Rules:
- "goodKo": one sentence in Korean naming something they genuinely did well.
  Be specific. Never generic praise.
- "upgrades": exactly 3, or fewer if the learner barely spoke. "said" must be
  a real quote from their turns. "better" is natural spoken English a native
  would actually use here. "whyKo" is one Korean sentence on the difference.
- Pick upgrades that generalize. Skip one-off word choices; prefer patterns
  they will need again.
- "newChunks": 2-4 reusable fragments from your "better" lines, with "~" for
  slots, plus a Korean gloss. These go into a drill deck.
- Everything in whyKo and goodKo is Korean. Everything else is English.`,
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Scenario: ${scenarioTitle}\nThe learner's goal was: ${goalKo}\n\nTranscript:\n${transcript}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
      // 예산을 안 주면 모델이 긴 thinking 을 잡고, 그 무거운 요청이 혼잡할 때
      // 가장 먼저 503 으로 잘린다. 리포트는 한 번에 끝나야 하므로 예산을 묶는다.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 1200,
    },
  });
  return parseJson<Report>(textOf(parts));
}

/* ---------------------------------------------------------------- 막힘 패턴 */

export type StallPattern = {
  /** 어떤 자리에서 막히는지 — 한국어 라벨 */
  labelKo: string;
  /** 왜 거기서 막히는지, 무엇을 연습하면 되는지 */
  adviceKo: string;
  /** 이 패턴에 해당하는 막힘 수 */
  count: number;
  /** 실제 발화에서 뽑은 예시 */
  examples: string[];
};

export type StallReport = {
  summaryKo: string;
  patterns: StallPattern[];
};

/**
 * 막힘을 세는 것과 어디서 막히는지 아는 것은 다른 일이다.
 * 누적된 막힘 자리를 묶어, 개인이 반복해서 걸려 넘어지는 자리를 찾는다.
 */
export async function analyzeStalls(stalls: Stall[]): Promise<StallReport> {
  if (!hasKey()) return mockStallReport(stalls);
  const model = await resolveModel("chat");
  const { parts } = await generate(model, {
    systemInstruction: {
      parts: [
        {
          text: `A Korean learner of English keeps stalling mid-sentence. You are given
every stall: the words just before it, and the words that came after.

Find the RECURRING structural positions where they break down. Group them.

Return ONLY JSON:
{"summaryKo": string,
 "patterns": [{"labelKo": string, "adviceKo": string, "count": number, "examples": string[]}]}

Rules:
- At most 4 patterns, ordered by count, highest first. Only patterns with at
  least two instances. If nothing recurs, return an empty patterns array.
- "labelKo": the grammatical position, in Korean, 12 characters or fewer.
  Examples: "동사 고르기 직전", "전치사 앞", "관계절 시작", "문장 첫 단어".
- "adviceKo": two sentences of Korean. First, why that spot is hard for Korean
  speakers specifically. Second, one concrete thing to drill.
- "examples": up to three verbatim "before → after" strings from the data.
- "summaryKo": one Korean sentence naming the single biggest pattern. If there
  is no clear pattern, say so plainly instead of inventing one.
- Never invent stalls that are not in the data.`,
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: stalls
              .map((x) => `[${x.kind}] "${x.before || "(문장 시작)"}" → "${x.after || "(여기서 멈춤)"}"`)
              .join(String.fromCharCode(10)),
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 1200,
    },
  });
  return parseJson<StallReport>(textOf(parts));
}

function mockStallReport(stalls: Stall[]): StallReport {
  if (stalls.length < 2) {
    return { summaryKo: "(목업) 아직 패턴을 볼 만큼 쌓이지 않았습니다.", patterns: [] };
  }
  return {
    summaryKo: "(목업) 동사를 고르는 자리에서 가장 자주 멈춥니다.",
    patterns: [
      {
        labelKo: "동사 고르기 직전",
        adviceKo:
          "(목업) 주어까지는 바로 나오는데 동사에서 멈추는 전형적인 패턴입니다. 자주 쓰는 동사 열 개를 덩어리째 입에 붙이세요.",
        count: stalls.length,
        examples: stalls.slice(0, 3).map((x) => `${x.before || "(문장 시작)"} → ${x.after || "(멈춤)"}`),
      },
    ],
  };
}

/* --------------------------------------------------------------------- TTS */

/** 0.85 = 1차(천천히), 1.0 = 2차(정상 속도) */
export async function synthesize(text: string, rate: number, voice = "Kore"): Promise<Buffer> {
  if (!hasKey()) return mockAudio();
  const model = await resolveModel("tts");
  const pace =
    rate < 0.95
      ? "Speak clearly and a little slower than usual, like you are talking to someone learning English."
      : "Speak at a natural, brisk conversational pace.";
  const { parts } = await generate(model, {
    contents: [{ role: "user", parts: [{ text: `${pace}\n\n${text}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const audio = parts.find((p): p is Extract<Part, { inlineData: unknown }> => "inlineData" in p);
  if (!audio) throw new Error("TTS returned no audio");
  const rateHz = Number(/rate=(\d+)/.exec(audio.inlineData.mimeType)?.[1] ?? 24000);
  return wav(Buffer.from(audio.inlineData.data, "base64"), rateHz);
}

/** Gemini TTS는 헤더 없는 16-bit PCM을 준다. 브라우저가 재생하도록 WAV로 감싼다. */
function wav(pcm: Buffer, sampleRate: number, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/* ------------------------------------------------------------------- mocks */

/**
 * 목업은 두 번째 턴에서 한국어 발화를 섞는다 — 키 없이도 한국어 구조대 경로를
 * 끝까지 확인할 수 있어야 하기 때문.
 */
let mockTurn = 0;

function mockTranscription(): Transcription {
  mockTurn += 1;
  if (mockTurn % 3 === 2) {
    return {
      text: "It was okay. 음, 그냥 집에서 밀린 일 좀 했어.",
      longPauses: 1,
      fillers: 1,
      koreanSpans: ["그냥 집에서 밀린 일 좀 했어"],
      stalls: [{ before: "It was okay", after: "그냥 집에서", kind: "filler" }],
    };
  }
  return {
    text: "Um, yeah, it was good. I, uh, I stayed home mostly and, um, watched something.",
    longPauses: 2,
    fillers: 4,
    koreanSpans: [],
    stalls: [
      { before: "", after: "yeah it was good", kind: "filler" },
      { before: "I", after: "I stayed home", kind: "filler" },
      { before: "stayed home mostly and", after: "watched something", kind: "filler" },
    ],
  };
}

function mockReply(history: Turn[]): string {
  const n = history.filter((t) => t.role === "user").length;
  const lines = [
    "Oh nice — tell me more about that.",
    "Really? How did that go?",
    "Ha, I know the feeling. And then what?",
    "That makes sense. Anything else on your mind?",
  ];
  return `(mock) ${lines[Math.min(n, lines.length - 1)]}`;
}

function mockReport(): Report {
  return {
    goodKo: "(목업) 단답으로 끝내지 않고 이유를 한 번 더 붙인 게 좋았습니다.",
    upgrades: [
      {
        said: "it was good",
        better: "it was pretty good, actually",
        whyKo: "actually 하나로 대화가 이어질 여지가 생깁니다.",
      },
      {
        said: "I stayed home",
        better: "I ended up staying home",
        whyKo: "계획이 아니라 그렇게 됐다는 뉘앙스가 훨씬 자연스럽습니다.",
      },
      {
        said: "watched something",
        better: "I got through half a series",
        whyKo: "구체적으로 말해야 상대가 되물을 거리가 생깁니다.",
      },
    ],
    newChunks: [
      { en: "I ended up ~ing", ko: "결국 ~하게 됐어" },
      { en: "~, actually", ko: "사실 ~야" },
    ],
  };
}

/** 키가 없을 때 오디오 파이프라인을 확인하기 위한 0.5초 사인파. */
function mockAudio(): Buffer {
  const rate = 24000;
  const samples = rate / 2;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, Math.min(i, samples - i) / (rate * 0.05));
    pcm.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 6000 * fade), i * 2);
  }
  return wav(pcm, rate);
}
