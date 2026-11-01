import { handler } from "@/lib/http";
import { DiagnosticReq } from "@/lib/api-schemas";
import { startDiagnostic } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handler(DiagnosticReq, (b) => startDiagnostic(b.topic, b.extraDocs));
