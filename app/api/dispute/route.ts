import { handler } from "@/lib/http";
import { DisputeReq } from "@/lib/api-schemas";
import { dispute } from "@/lib/orchestrator";

export const runtime = "nodejs";
// Vercel: up to 300 s needs Fluid compute (default for new projects); see README "Deploy on Vercel".
export const maxDuration = 120;

export const POST = handler(DisputeReq, (b) => dispute(b), { maxDuration });
