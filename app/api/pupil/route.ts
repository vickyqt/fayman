import { handler } from "@/lib/http";
import { PupilReq } from "@/lib/api-schemas";
import { teachBackTurn } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = handler(PupilReq, (b) => teachBackTurn(b));
