import { NextResponse } from "next/server";
import { hasKey, listModels, resolveModel } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 키를 꽂은 뒤 여기부터 확인한다. 어떤 모델이 실제로 잡혔는지 보여준다. */
export async function GET() {
  if (!hasKey()) {
    return NextResponse.json({
      key: false,
      mode: "mock",
      hint: "GEMINI_API_KEY를 설정하면 실제 음성 대화로 전환됩니다.",
    });
  }
  try {
    const [chat, stt, tts, all] = await Promise.all([
      resolveModel("chat"),
      resolveModel("stt"),
      resolveModel("tts"),
      listModels(),
    ]);
    return NextResponse.json({ key: true, mode: "live", resolved: { chat, stt, tts }, available: all });
  } catch (e) {
    return NextResponse.json(
      { key: true, mode: "error", error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
