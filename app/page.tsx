import { hasKey } from "@/lib/gemini";
import { Home } from "@/components/Home";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Home liveMode={hasKey()} />;
}
