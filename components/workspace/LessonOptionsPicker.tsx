"use client";
import { DEPTHS, describeOptions, INTERACTIVITY, LENGTHS } from "@/lib/lesson-options";
import type { LessonOptions } from "@/lib/schemas";

type Opt<V extends string> = { value: V; label: string; hint: string; bars?: number };

function Segmented<V extends string>({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string;
  label: string;
  value: V;
  options: Opt<V>[];
  onChange: (v: V) => void;
}) {
  return (
    <fieldset className="seg-field">
      <legend>{label}</legend>
      <div className="seg" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            name={name}
            className="seg-opt"
            onClick={() => onChange(o.value)}
          >
            <span className="seg-label">
              {o.bars !== undefined && (
                <span className="meter" aria-hidden>
                  {[1, 2, 3, 4].map((i) => (
                    <i key={i} className={i <= o.bars! ? "on" : ""} />
                  ))}
                </span>
              )}
              {o.label}
            </span>
            <span className="seg-hint">{o.hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Length, depth and amount of interactive content for the generated lesson. */
export function LessonOptionsPicker({
  value,
  onChange,
  autoHint,
}: {
  value: LessonOptions;
  /** Receives only the changed field; merge it with a functional state update. */
  onChange: (patch: Partial<LessonOptions>) => void;
  /** Shown under "Auto" depth, e.g. what the diagnostic suggests. */
  autoHint?: string;
}) {
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Segmented
        name="length"
        label="Length"
        value={value.length}
        onChange={(length) => onChange({ length })}
        options={(Object.keys(LENGTHS) as (keyof typeof LENGTHS)[]).map((k) => ({ value: k, label: LENGTHS[k].label, hint: LENGTHS[k].hint }))}
      />
      <Segmented
        name="depth"
        label="Depth"
        value={value.depth}
        onChange={(depth) => onChange({ depth })}
        options={[
          { value: "auto" as const, label: "Auto", hint: autoHint ?? "Matched to your answers" },
          ...(Object.keys(DEPTHS) as (keyof typeof DEPTHS)[]).map((k) => ({ value: k, label: DEPTHS[k].label, hint: DEPTHS[k].hint })),
        ]}
      />
      <Segmented
        name="interactivity"
        label="Interactive content"
        value={value.interactivity}
        onChange={(interactivity) => onChange({ interactivity })}
        options={(Object.keys(INTERACTIVITY) as (keyof typeof INTERACTIVITY)[]).map((k) => ({
          value: k,
          label: INTERACTIVITY[k].label,
          hint: INTERACTIVITY[k].hint,
          bars: INTERACTIVITY[k].bars,
        }))}
      />
      <div className="small muted mono" aria-live="polite">
        → {describeOptions(value)}
      </div>
    </div>
  );
}
