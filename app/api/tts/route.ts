import { synthesize } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { text, rate } = (await req.json()) as { text?: string; rate?: number };
    if (!text) return new Response(JSON.stringify({ error: "text is required" }), { status: 400 });
    const wav = await synthesize(text, typeof rate === "number" ? rate : 1);
    return new Response(new Uint8Array(wav), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
