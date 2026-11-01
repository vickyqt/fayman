import { handler } from "@/lib/http";
import { NoteReq } from "@/lib/api-schemas";
import { captureNote } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = handler(NoteReq, (b) => captureNote(b));
