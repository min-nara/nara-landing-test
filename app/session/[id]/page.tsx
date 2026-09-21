import { notFound } from "next/navigation";
import { getScenario } from "@/lib/scenarios";
import { Session } from "@/components/Session";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scenario = getScenario(id);
  if (!scenario) notFound();
  return <Session scenario={scenario} />;
}
