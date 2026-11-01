import { handler } from "@/lib/http";
import { LessonReq } from "@/lib/api-schemas";
import { createLesson } from "@/lib/orchestrator";

export const runtime = "nodejs";
// Vercel: up to 300 s needs Fluid compute (default for new projects); see README "Deploy on Vercel".
export const maxDuration = 300;

export const POST = handler(LessonReq, (b) => createLesson(b), { maxDuration });
