import { handler } from "@/lib/http";
import { DisputeReq } from "@/lib/api-schemas";
import { dispute } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 90;

export const POST = handler(DisputeReq, (b) => dispute(b));
