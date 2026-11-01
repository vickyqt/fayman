import { handler } from "@/lib/http";
import { DiagnosticReq } from "@/lib/api-schemas";
import { startDiagnostic } from "@/lib/orchestrator";

export const runtime = "nodejs";
// Vercel: up to 300 s needs Fluid compute (default for new projects); see README "Deploy on Vercel".
export const maxDuration = 60;

export const POST = handler(DiagnosticReq, (b) => startDiagnostic(b.topic, b.extraDocs), { maxDuration });
