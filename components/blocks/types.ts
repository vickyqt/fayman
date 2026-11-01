import type { GuardedBlock } from "@/lib/schemas";

export interface Focus {
  title: string;
  detail: string;
}

export interface BlockProps<T extends GuardedBlock = GuardedBlock> {
  block: T;
  /** Report live widget state; used as the snapshot when capturing notes. */
  onState: (state: Record<string, unknown>) => void;
  /** Capture a sub-concept (diagram node, step, trace line) to notes. */
  onCapture: (focus?: Focus) => void;
  /** Speak text aloud (Teacher voice). */
  narrate: (text: string, onEnd?: () => void) => void;
}

export type Of<K extends GuardedBlock["type"]> = Extract<GuardedBlock, { type: K }>;
