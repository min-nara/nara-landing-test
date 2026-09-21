import { NextResponse } from "next/server";
import { buildReport } from "@/lib/gemini";
import { getScenario } from "@/lib/scenarios";
import type { StoredTurn } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { scenarioId, turns } = (await req.json()) as {
      scenarioId?: string;
      turns?: StoredTurn[];
    };
    const scenario = scenarioId ? getScenario(scenarioId) : undefined;
    if (!scenario) return NextResponse.json({ error: "unknown scenario" }, { status: 400 });

    const transcript = (turns ?? [])
      .map((t) => `${t.role === "ai" ? scenario.aiRole : "Learner"}: ${t.text}`)
      .join("\n");

    return NextResponse.json(await buildReport(scenario.title, scenario.goalKo, transcript));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
