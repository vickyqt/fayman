"use client";
import { useEffect, useRef, useState } from "react";
import { canSpeak, speak, stopSpeakingIf, useSpeechOwner } from "@/lib/client/speech";
import type { BlockProps, Of } from "./types";

const COLOR = { ok: "var(--green)", error: "var(--red)", neutral: "var(--black)" } as const;

export function FlowStepperDiagram({ block, onState, onCapture }: BlockProps<Of<"stepper">>) {
  const [sc, setSc] = useState(0);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [voice, setVoice] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const me = `stepper:${block.id}`;
  const speaking = useSpeechOwner();

  useEffect(() => setVoiceOk(canSpeak()), []);

  const scenario = block.scenarios[Math.min(sc, block.scenarios.length - 1)];
  const steps = scenario.steps;
  const step = steps[i];
  const prev = i > 0 ? steps[i - 1] : undefined;

  useEffect(() => {
    onState({ scenario: scenario.label, step: `${i + 1}/${steps.length}: ${step.label}`, ...step.state });
  }, [scenario, i, step, steps.length, onState]);

  // Playback: advance on a timer, or when the narration for this step finishes.
  // Each run owns its callback; a stale one (from an interrupted narration) is ignored.
  useEffect(() => {
    if (!playing) return;
    let live = true;
    const advance = () => {
      if (!live) return;
      if (i >= steps.length - 1) setPlaying(false);
      else setI((x) => x + 1);
    };
    if (voice && voiceOk) speak(`${step.label.replace(/[=+]/g, " ")}. ${step.detail}`, { owner: me, onEnd: advance });
    else timer.current = setTimeout(advance, 1900);
    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
      stopSpeakingIf(me);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, i, sc, voice]);

  // Another block (or the Pupil) started talking: pause instead of hanging mid-step.
  useEffect(() => {
    if (playing && voice && speaking && speaking !== me) setPlaying(false);
  }, [speaking, playing, voice, me]);

  useEffect(() => () => stopSpeakingIf(me), [me]);

  const go = (n: number) => {
    setPlaying(false);
    stopSpeakingIf(me);
    setI(Math.max(0, Math.min(steps.length - 1, n)));
  };

  /* --- SVG sequence diagram --- */
  const W = 680;
  const top = 58;
  const rowH = 46;
  const H = top + steps.length * rowH + 24;
  const laneX = (id: string) => {
    const idx = block.lanes.findIndex((l) => l.id === id);
    const pad = 90;
    return block.lanes.length === 1 ? W / 2 : pad + (idx * (W - 2 * pad)) / (block.lanes.length - 1);
  };

  return (
    <div>
      <p>{block.description}</p>
      {block.scenarios.length > 1 && (
        <div className="row" role="tablist" aria-label="Scenarios" style={{ marginBottom: 10 }}>
          {block.scenarios.map((s, k) => (
            <button
              key={s.id}
              role="tab"
              aria-selected={k === sc}
              className={`btn sm ${k === sc ? "active" : ""}`}
              onClick={() => {
                setSc(k);
                setI(0);
                setPlaying(false);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="seq" role="img" aria-label={`Sequence diagram: ${scenario.label}`}>
        <defs>
          {(["ok", "error", "neutral", "blue"] as const).map((k) => (
            <marker key={k} id={`arw-${block.id}-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill={k === "blue" ? "var(--blue)" : COLOR[k]} />
            </marker>
          ))}
        </defs>
        {block.lanes.map((l) => (
          <g key={l.id}>
            <rect x={laneX(l.id) - 60} y={10} width={120} height={30} fill="var(--white)" stroke="var(--black)" strokeWidth={2} />
            <text x={laneX(l.id)} y={30} textAnchor="middle" fontWeight={700} fontSize={13} fontFamily="var(--font)" fill="var(--black)">
              {l.label}
            </text>
            <line x1={laneX(l.id)} x2={laneX(l.id)} y1={40} y2={H - 8} stroke="var(--black)" strokeWidth={1.5} strokeDasharray="5 4" />
          </g>
        ))}
        {steps.map((s, k) => {
          if (k > i) return null;
          const y = top + k * rowH + 18;
          const x1 = laneX(s.from);
          const x2 = laneX(s.to);
          const cur = k === i;
          const tone = cur ? (s.status === "neutral" ? "blue" : s.status) : s.status;
          const stroke = tone === "blue" ? "var(--blue)" : COLOR[tone as keyof typeof COLOR];
          const dropped = s.status === "error" && /drop|lost|✕/i.test(s.label);
          const endX = dropped ? x1 + (x2 - x1) * 0.62 : x2 - Math.sign(x2 - x1) * 4;
          return (
            <g key={k} onClick={() => go(k)} style={{ cursor: "pointer" }} opacity={cur ? 1 : 0.55}>
              {x1 === x2 ? (
                <rect x={x1 - 8} y={y - 12} width={16} height={24} fill={stroke} />
              ) : (
                <line
                  x1={x1}
                  x2={endX}
                  y1={y}
                  y2={y}
                  stroke={stroke}
                  strokeWidth={cur ? 3 : 2}
                  markerEnd={dropped ? undefined : `url(#arw-${block.id}-${tone})`}
                />
              )}
              {dropped && (
                <text x={endX + 4} y={y + 6} fontSize={18} fontWeight={700} fill="var(--red)">
                  ✕
                </text>
              )}
              <text
                x={x1 === x2 ? x1 + 14 : (x1 + x2) / 2}
                y={y - 8}
                textAnchor={x1 === x2 ? "start" : "middle"}
                fontSize={12.5}
                fontFamily="var(--mono)"
                fontWeight={cur ? 700 : 500}
                fill={stroke}
              >
                {s.label}
              </text>
              <rect x={0} y={y - 22} width={W} height={rowH - 4} fill="transparent" />
            </g>
          );
        })}
      </svg>

      <div className="row" style={{ marginTop: 10 }}>
        <div className="controls" aria-label="Playback">
          <button className="btn sm" onClick={() => go(0)} aria-label="Restart">⏮</button>
          <button className="btn sm" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Step back">◀</button>
          <button
            className="btn sm primary"
            onClick={() => {
              if (i >= steps.length - 1) setI(0);
              setPlaying((p) => !p);
            }}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button className="btn sm" onClick={() => go(i + 1)} disabled={i >= steps.length - 1} aria-label="Step forward">▶</button>
        </div>
        {voiceOk && (
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Narrate while playing
          </label>
        )}
        <span className="spacer" />
        <span className="tag">
          step {i + 1}/{steps.length}
        </span>
      </div>

      <div className={`stepdetail ${step.status}`} aria-live="polite">
        <div className="row">
          <strong className="mono">{step.label}</strong>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={() => onCapture({ title: `${scenario.label}: ${step.label}`, detail: step.detail })}>
            ＋ Capture step
          </button>
        </div>
        <p style={{ margin: "6px 0 0" }}>{step.detail}</p>
      </div>

      {Object.keys(step.state).length > 0 && (
        <div className="statevars">
          {Object.entries(step.state).map(([k, v]) => (
            <div key={k} className={`statevar ${prev && prev.state[k] !== v ? "changed" : ""}`}>
              <span className="k">{k}</span>
              {v}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
