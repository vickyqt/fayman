/**
 * Provider-agnostic LLM layer.
 *
 * Every agent calls `completeJSON(request, zodSchema)`. Switching providers is a
 * single env var (LLM_PROVIDER). Adapters use plain fetch, so there are no SDK
 * dependencies and adding a provider is ~30 lines.
 *
 *   mock               offline scripted demo (no key needed)
 *   anthropic          Claude via the Messages API
 *   openai             OpenAI Chat Completions
 *   gemini             Google Gemini generateContent
 *   openai-compatible  Ollama / Groq / Together / vLLM / LM Studio ...
 */
import type { ZodType, ZodTypeDef } from "zod";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  /** Short label for logs, e.g. "architect.lesson" */
  tag?: string;
}

export type ProviderName = "mock" | "anthropic" | "openai" | "gemini" | "openai-compatible";

const DEFAULT_MODELS: Record<ProviderName, string> = {
  mock: "mock",
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-4.1-mini",
  gemini: "gemini-2.5-flash",
  "openai-compatible": "llama3.1",
};

export function provider(): ProviderName {
  const p = (process.env.LLM_PROVIDER || "mock").toLowerCase() as ProviderName;
  return p in DEFAULT_MODELS ? p : "mock";
}

export function isMock(): boolean {
  return provider() === "mock";
}

export function providerInfo() {
  const p = provider();
  return { provider: p, model: process.env.LLM_MODEL || DEFAULT_MODELS[p] };
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new LLMError(`Missing ${name} for LLM_PROVIDER=${provider()}`);
  return v;
}

export class LLMError extends Error {}

async function postJSON(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new LLMError(`${res.status} from ${new URL(url).host}: ${text.slice(0, 400)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropic(req: LLMRequest, model: string): Promise<string> {
  const data = await postJSON(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": need("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
    {
      model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.4,
      system: req.system,
      messages: req.messages,
    },
  );
  return (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

async function callOpenAI(req: LLMRequest, model: string, baseUrl: string, key: string | undefined): Promise<string> {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  const data = await postJSON(`${baseUrl.replace(/\/$/, "")}/chat/completions`, headers, {
    model,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.4,
    ...(req.json ? { response_format: { type: "json_object" } } : {}),
    messages: [{ role: "system", content: req.system }, ...req.messages],
  });
  return data.choices?.[0]?.message?.content ?? "";
}

async function callGemini(req: LLMRequest, model: string): Promise<string> {
  const key = need("GEMINI_API_KEY");
  const data = await postJSON(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": key },
    {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxTokens ?? 4096,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    },
  );
  return (data.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
}

export async function complete(req: LLMRequest): Promise<string> {
  const { provider: p, model } = providerInfo();
  const started = Date.now();
  let out: string;
  switch (p) {
    case "anthropic":
      out = await callAnthropic(req, model);
      break;
    case "openai":
      out = await callOpenAI(req, model, "https://api.openai.com/v1", need("OPENAI_API_KEY"));
      break;
    case "openai-compatible":
      out = await callOpenAI(
        req,
        model,
        process.env.OPENAI_COMPATIBLE_BASE_URL || "http://localhost:11434/v1",
        process.env.OPENAI_COMPATIBLE_API_KEY,
      );
      break;
    case "gemini":
      out = await callGemini(req, model);
      break;
    default:
      throw new LLMError("LLM_PROVIDER=mock: agents must use their offline fixtures");
  }
  console.log(`[llm] ${p}/${model} ${req.tag ?? ""} ${Date.now() - started}ms`);
  return out;
}

/** Pull the first JSON object out of a model reply (tolerates ``` fences and preambles). */
export function extractJSON(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object found in model output");
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * Ask for JSON, validate with zod, and on failure feed the validation errors
 * back to the model (self-repair). This is the first line of Agent 5's schema
 * compliance: nothing unvalidated ever leaves the server.
 */
export async function completeJSON<T>(
  req: LLMRequest,
  schema: ZodType<T, ZodTypeDef, unknown>,
  retries = 2,
): Promise<T> {
  const messages = [...req.messages];
  let lastErr = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await complete({ ...req, messages, json: true });
    try {
      const parsed = schema.safeParse(extractJSON(raw));
      if (parsed.success) return parsed.data;
      lastErr = parsed.error.issues
        .slice(0, 12)
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
    } catch (e) {
      lastErr = (e as Error).message;
    }
    console.warn(`[llm] ${req.tag ?? ""} invalid JSON (attempt ${attempt + 1}): ${lastErr.slice(0, 300)}`);
    messages.push(
      { role: "assistant", content: raw.slice(0, 6000) },
      {
        role: "user",
        content: `That output failed validation:\n${lastErr}\nReturn the complete corrected JSON object only, no commentary.`,
      },
    );
  }
  throw new LLMError(`Model output failed validation after ${retries + 1} attempts: ${lastErr}`);
}
