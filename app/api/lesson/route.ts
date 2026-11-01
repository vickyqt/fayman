import { handler } from "@/lib/http";
import { LessonReq } from "@/lib/api-schemas";
import { createLesson } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = handler(LessonReq, (b) => createLesson(b));
