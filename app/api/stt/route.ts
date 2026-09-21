import { NextResponse } from "next/server";
import { transcribe } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { audio, mimeType } = (await req.json()) as { audio?: string; mimeType?: string };
    if (!audio) return NextResponse.json({ error: "audio is required" }, { status: 400 });
    const result = await transcribe(audio, mimeType || "audio/webm");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
