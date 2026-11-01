import { NextResponse } from "next/server";
import type { ZodType, ZodTypeDef } from "zod";
import { LLMError } from "@/lib/llm";

/** Validate the JSON body, run the handler, map errors to useful responses. */
export function handler<I>(schema: ZodType<I, ZodTypeDef, unknown>, fn: (input: I) => Promise<unknown>) {
  return async (req: Request) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    try {
      return NextResponse.json(await fn(parsed.data));
    } catch (e) {
      const err = e as Error;
      console.error("[api]", err);
      const status = err instanceof LLMError ? 502 : 500;
      return NextResponse.json({ error: err.message.slice(0, 600) }, { status });
    }
  };
}
