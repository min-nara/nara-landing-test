import { NextResponse } from "next/server";
import { rescueKorean } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { korean, context } = (await req.json()) as { korean?: string; context?: string };
    if (!korean) return NextResponse.json({ error: "korean is required" }, { status: 400 });
    return NextResponse.json(await rescueKorean(korean, context ?? ""));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
