"use client";
import { useEffect, useMemo, useState } from "react";
import { evaluate } from "@/lib/expr";
import type { BlockProps, Of } from "./types";

function safe(expr: string | undefined, env: Record<string, number>): number | null {
  if (!expr) return null;
  try {
    const v = evaluate(expr, env);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

function fmt(v: number | null, decimals: number) {
  if (v === null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}

export function InteractiveSliderBlock({ block, onState }: BlockProps<Of<"slider">>) {
  const initial = useMemo(() => Object.fromEntries(block.params.map((p) => [p.name, p.default])), [block.params]);
  const [env, setEnv] = useState<Record<string, number>>(initial);

  const results = block.outputs.map((o) => {
    const v = safe(o.expr, env);
    const good = safe(o.goodWhen, env);
    const bad = safe(o.badWhen, env);
    const status = bad ? "error" : good ? "ok" : "";
    return { o, v, status };
  });

  useEffect(() => {
    onState({
      ...Object.fromEntries(block.params.map((p) => [p.label, `${env[p.name]}${p.unit ? " " + p.unit : ""}`])),
      ...Object.fromEntries(results.map((r) => [r.o.label, `${fmt(r.v, r.o.decimals)}${r.o.unit ? " " + r.o.unit : ""}`])),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env]);

  return (
    <div>
      <p>{block.description}</p>
      <div className="sim">
        <div className="stack">
          {block.params.map((p) => (
            <div className="param" key={p.name}>
              <label htmlFor={`${block.id}-${p.name}`}>
                <span>{p.label}</span>
                <output>
                  {env[p.name]}
                  {p.unit ? ` ${p.unit}` : ""}
                </output>
              </label>
              <input
                id={`${block.id}-${p.name}`}
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={env[p.name]}
                onChange={(e) => setEnv((s) => ({ ...s, [p.name]: Number(e.target.value) }))}
              />
            </div>
          ))}
          <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setEnv(initial)}>
            Reset
          </button>
        </div>
        <div className="stack">
          {results.map(({ o, v, status }) => (
            <div key={o.label} className={`metric ${status}`} aria-live="polite">
              <span className="small">{o.label}</span>
              <span className="v">
                {fmt(v, o.decimals)}
                {o.unit ? <span className="small"> {o.unit}</span> : null}
              </span>
            </div>
          ))}
        </div>
      </div>
      {block.chart && <SweepChart block={block} env={env} />}
      <div className="insight">
        <strong>Insight. </strong>
        {block.insight}
      </div>
    </div>
  );
}

/** Sweeps one parameter across its range and plots one output. */
function SweepChart({ block, env }: { block: Of<"slider">; env: Record<string, number> }) {
  const chart = block.chart!;
  const p = block.params.find((x) => x.name === chart.x);
  const out = block.outputs[chart.outputIndex];
  if (!p || !out) return null;

  const N = 48;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const x = p.min + ((p.max - p.min) * i) / N;
    const e = { ...env, [p.name]: x };
    return { x, y: safe(out.expr, e), bad: !!safe(out.badWhen, e), good: !!safe(out.goodWhen, e) };
  }).filter((d): d is { x: number; y: number; bad: boolean; good: boolean } => d.y !== null);
  if (pts.length < 2) return null;

  const W = 640, H = 200, L = 56, R = 12, T = 12, B = 34;
  const ys = pts.map((d) => d.y);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys) || 1;
  const sx = (x: number) => L + ((x - p.min) / (p.max - p.min)) * (W - L - R);
  const sy = (y: number) => T + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - T - B);
  const path = pts.map((d, i) => `${i ? "L" : "M"}${sx(d.x).toFixed(1)},${sy(d.y).toFixed(1)}`).join(" ");
  const curY = safe(out.expr, env);
  const ticks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <figure style={{ margin: "16px 0 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="seq" role="img" aria-label={`${out.label} as ${p.label} changes`}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={sy(t)} y2={sy(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 6} y={sy(t) + 4} fontSize={11} textAnchor="end" fontFamily="var(--mono)" fill="var(--muted)">
              {Math.round(t).toLocaleString()}
            </text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--black)" strokeWidth={2} />
        <line x1={L} x2={L} y1={T} y2={H - B} stroke="var(--black)" strokeWidth={2} />
        <path d={path} fill="none" stroke="var(--black)" strokeWidth={2.5} />
        {pts.filter((d) => d.bad).map((d, i) => (
          <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={2.6} fill="var(--red)" />
        ))}
        {curY !== null && (
          <g>
            <line x1={sx(env[p.name])} x2={sx(env[p.name])} y1={T} y2={H - B} stroke="var(--blue)" strokeDasharray="4 3" strokeWidth={1.5} />
            <rect x={sx(env[p.name]) - 6} y={sy(curY) - 6} width={12} height={12} fill="var(--blue)" stroke="var(--black)" strokeWidth={2} />
          </g>
        )}
        <text x={(L + W - R) / 2} y={H - 8} fontSize={12} textAnchor="middle" fontFamily="var(--font)" fill="var(--black)">
          {p.label}
          {p.unit ? ` (${p.unit})` : ""}
        </text>
      </svg>
      <figcaption className="small muted" style={{ marginTop: 4 }}>
        {out.label} across the full range of {p.label.toLowerCase()}. Blue marker = your setting; red points = bottleneck zone.
      </figcaption>
    </figure>
  );
}
