import { handler } from "@/lib/http";
import { ReimagineReq } from "@/lib/api-schemas";
import { reimagine } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = handler(ReimagineReq, (b) => reimagine(b));
