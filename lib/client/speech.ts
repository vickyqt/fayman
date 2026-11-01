"use client";
/**
 * Voice modality via the browser's Web Speech API (no keys, no server).
 * TTS: Teacher narration + Pupil voice. STT: hands-free teach-back.
 * Chrome/Edge/Safari support both; Firefox supports TTS only.
 *
 * Browser quirks handled here:
 *  - Every speak() starts a new "generation"; callbacks from cancelled
 *    utterances are ignored, so a stepper can't double-advance when its
 *    narration is interrupted.
 *  - Chrome drops speak() issued in the same tick as cancel(), and cuts long
 *    utterances off after ~15 s, so text is spoken in sentence-sized chunks
 *    with a short delay after a cancel.
 *  - Chrome can garbage-collect an in-flight utterance (onend never fires);
 *    the current one is pinned and a watchdog moves on if the engine stalls.
 *  - Voices load asynchronously; the best local-language voice is picked
 *    once they arrive, with a different voice for the Pupil when possible.
 */
import { useEffect, useState } from "react";

export type Persona = "teacher" | "pupil";

export function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/* ---------------- voices ---------------- */

let voices: SpeechSynthesisVoice[] = [];

function loadVoices() {
  if (!canSpeak()) return;
  voices = window.speechSynthesis.getVoices();
}

if (canSpeak()) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

function rankVoices(): SpeechSynthesisVoice[] {
  const want = (typeof navigator !== "undefined" && navigator.language) || "en-US";
  const base = want.split("-")[0].toLowerCase();
  const score = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.toLowerCase();
    let s = 0;
    if (lang === want.toLowerCase()) s += 6;
    else if (lang.startsWith(base)) s += 4;
    if (/natural|neural|enhanced|premium/i.test(v.name)) s += 3;
    if (/google|microsoft|samantha|daniel|aria|jenny|guy/i.test(v.name)) s += 1;
    if (v.default) s += 1;
    return s;
  };
  return [...voices].filter((v) => v.lang.toLowerCase().startsWith(base)).sort((a, b) => score(b) - score(a));
}

function voiceFor(persona: Persona): SpeechSynthesisVoice | undefined {
  const ranked = rankVoices();
  if (!ranked.length) return undefined;
  return persona === "pupil" ? (ranked[1] ?? ranked[0]) : ranked[0];
}

/* ---------------- speaking state (who is talking) ---------------- */

let owner: string | null = null;
const listeners = new Set<(o: string | null) => void>();

function setOwner(o: string | null) {
  owner = o;
  listeners.forEach((l) => l(o));
}

/** The owner key of whatever is speaking right now (null = silent). */
export function useSpeechOwner(): string | null {
  const [o, setO] = useState<string | null>(owner);
  useEffect(() => {
    listeners.add(setO);
    setO(owner);
    return () => {
      listeners.delete(setO);
    };
  }, []);
  return o;
}

/* ---------------- TTS ---------------- */

let generation = 0;
let pinned: SpeechSynthesisUtterance | null = null; // keeps Chrome from GC-ing the live utterance
let watchdog: ReturnType<typeof setTimeout> | null = null;

function clean(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Sentence-sized chunks (≤ ~220 chars) so Chrome never hits its ~15 s cutoff. */
export function splitForSpeech(text: string, max = 220): string[] {
  const sentences = text.match(/[^.!?;:]+[.!?;:]*\s*/g) ?? [text];
  const out: string[] = [];
  let buf = "";
  for (const raw of sentences) {
    let s = raw;
    while (s.length > max) {
      const cut = s.lastIndexOf(" ", max) > 40 ? s.lastIndexOf(" ", max) : max;
      if (buf) {
        out.push(buf.trim());
        buf = "";
      }
      out.push(s.slice(0, cut).trim());
      s = s.slice(cut);
    }
    if (buf && buf.length + s.length > max) {
      out.push(buf.trim());
      buf = "";
    }
    buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  persona?: Persona;
  /** Identifies the speaker (e.g. "block:abc"); exposed via useSpeechOwner(). */
  owner?: string;
  /** Called once when the whole text has been spoken. NOT called if interrupted. */
  onEnd?: () => void;
}

export function speak(text: string, opts: SpeakOptions = {}) {
  const chunks = splitForSpeech(clean(text));
  if (!canSpeak() || !chunks.length) {
    opts.onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  const id = ++generation;
  const busy = synth.speaking || synth.pending;
  synth.cancel();
  if (watchdog) clearTimeout(watchdog);
  setOwner(opts.owner ?? "global");

  const persona = opts.persona ?? "teacher";
  const rate = opts.rate ?? 1.02;
  let idx = 0;

  const next = () => {
    if (id !== generation) return; // superseded or stopped
    if (watchdog) clearTimeout(watchdog);
    if (idx >= chunks.length) {
      pinned = null;
      setOwner(null);
      opts.onEnd?.();
      return;
    }
    const chunk = chunks[idx++];
    const u = new SpeechSynthesisUtterance(chunk);
    const v = voiceFor(persona);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.rate = rate;
    u.pitch = opts.pitch ?? (persona === "pupil" ? 1.15 : 1);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      next();
    };
    u.onend = finish;
    u.onerror = (e) => {
      // "interrupted"/"canceled" come from our own cancel(): the generation check in next() ignores them.
      if (e.error === "interrupted" || e.error === "canceled") return;
      finish(); // skip a chunk the engine couldn't say rather than stalling
    };
    pinned = u;
    synth.speak(u);
    if (synth.paused) synth.resume();
    // Watchdog: some engines never fire onend. Allow generous time per chunk.
    watchdog = setTimeout(() => {
      if (id === generation && !done && !synth.speaking) finish();
    }, 4000 + (chunk.length / 9) * 1000 / rate);
  };

  // Chrome silently drops a speak() queued right after cancel().
  if (busy) setTimeout(next, 90);
  else next();
}

export function stopSpeaking() {
  generation++;
  if (watchdog) clearTimeout(watchdog);
  pinned = null;
  if (canSpeak()) window.speechSynthesis.cancel();
  if (owner !== null) setOwner(null);
}

/** Stop only if `key` is the one speaking (so one widget can't silence another). */
export function stopSpeakingIf(key: string) {
  if (owner === key) stopSpeaking();
}

/* ---------------- STT ---------------- */

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

export function canListen() {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

const STT_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone permission was denied. Allow it in the address bar, then try again.",
  "service-not-allowed": "Speech recognition is blocked in this browser or profile.",
  "audio-capture": "No microphone was found. Check that one is connected and not used by another app.",
  network: "Speech recognition needs an internet connection (the browser sends audio to its speech service).",
  "language-not-supported": "Speech recognition doesn't support your browser language.",
};

export interface Dictation {
  /** Stop listening but keep any words still being recognised. */
  stop(): void;
  /** Stop immediately and ignore anything still in flight (e.g. after sending). */
  abort(): void;
}

/**
 * Starts dictation; calls onText with the full running transcript.
 * Chrome ends "continuous" sessions after a pause; we restart transparently
 * until the user stops, so long explanations aren't cut short.
 */
export function listen(onText: (text: string, final: boolean) => void, onStop: (err?: string) => void): Dictation {
  const noop = { stop() {}, abort() {} };
  const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!Ctor) {
    onStop("Speech recognition isn't supported in this browser. Try Chrome, Edge or Safari.");
    return noop;
  }
  if (!window.isSecureContext) {
    onStop("The microphone only works over HTTPS or on localhost.");
    return noop;
  }

  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || "en-US";

  let committed = ""; // final text from earlier sessions (after auto-restarts)
  let sessionFinal = "";
  let wantStop = false;
  let aborted = false;
  let ended = false;
  let fatal: string | undefined;
  let restarts = 0;

  rec.onresult = (e) => {
    if (aborted) return;
    let fin = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) fin += r[0].transcript + " ";
      else interim += r[0].transcript;
    }
    sessionFinal = fin;
    onText(`${committed}${fin}${interim}`.replace(/\s+/g, " ").trim(), !interim);
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return; // benign: onend decides what happens next
    fatal = STT_ERRORS[e.error] ?? `Speech recognition error: ${e.error}`;
  };
  rec.onend = () => {
    committed += sessionFinal;
    sessionFinal = "";
    if (!wantStop && !aborted && !fatal && restarts < 30) {
      restarts++;
      try {
        rec.start();
        return;
      } catch {
        /* fall through to stop */
      }
    }
    if (ended) return;
    ended = true;
    onStop(aborted ? undefined : fatal);
  };

  try {
    rec.start();
  } catch (e) {
    onStop((e as Error).message);
    return noop;
  }
  return {
    stop() {
      wantStop = true;
      try {
        rec.stop();
      } catch {}
    },
    abort() {
      wantStop = true;
      aborted = true;
      try {
        rec.abort();
      } catch {}
    },
  };
}
