import { NextResponse } from "next/server";
import type { output, ZodType } from "zod";
import { LLMError, withTimeBudget } from "@/lib/llm";

/** Seconds kept back from a route's maxDuration so it can still answer with a useful error. */
const MARGIN_S = 8;

/**
 * Validate the JSON body, run the handler inside a time budget derived from the
 * route's maxDuration, and map errors to useful responses.
 */
export function handler<S extends ZodType>(
  schema: S,
  fn: (input: output<S>) => Promise<unknown>,
  opts: { maxDuration?: number } = {},
) {
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
        { error: "Invalid request", issues: parsed.error.issues.slice(0, 8).map((i) => `${i.path.map(String).join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    try {
      const run = () => fn(parsed.data as output<S>);
      const result = opts.maxDuration ? await withTimeBudget(Math.max(10, opts.maxDuration - MARGIN_S) * 1000, run) : await run();
      return NextResponse.json(result);
    } catch (e) {
      const err = e as Error;
      console.error("[api]", err);
      const status = err instanceof LLMError ? 502 : 500;
      return NextResponse.json({ error: err.message.slice(0, 600) }, { status });
    }
  };
}
