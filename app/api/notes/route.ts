import { handler } from "@/lib/http";
import { NoteReq } from "@/lib/api-schemas";
import { captureNote } from "@/lib/orchestrator";

export const runtime = "nodejs";
// Vercel: up to 300 s needs Fluid compute (default for new projects); see README "Deploy on Vercel".
export const maxDuration = 30;

export const POST = handler(NoteReq, (b) => captureNote(b), { maxDuration });
