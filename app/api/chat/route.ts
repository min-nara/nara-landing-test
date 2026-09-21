import { NextResponse } from "next/server";
import { chatTurn, type Turn } from "@/lib/gemini";
import { getScenario } from "@/lib/scenarios";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { scenarioId, history, round } = (await req.json()) as {
      scenarioId?: string;
      history?: Turn[];
      round?: number;
    };
    const scenario = scenarioId ? getScenario(scenarioId) : undefined;
    if (!scenario) return NextResponse.json({ error: "unknown scenario" }, { status: 400 });

    const pace =
      round && round >= 2
        ? "This is the learner's second run at the same scenario. Move a little faster and keep your turns shorter."
        : "This is the learner's first run. Give them room.";

    const system = `${scenario.direction}

${pace}

Hard rules, without exception:
- Reply with spoken dialogue only. No stage directions, no emoji, no markdown.
- One to two sentences. You are talking, not writing.
- Never correct the learner's grammar or vocabulary, and never comment on their
  English. A coach handles that after the conversation; your only job is to keep
  them talking.
- If they say something unclear, react like a real person would: guess, or ask.`;

    const reply = await chatTurn(system, history ?? []);
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
