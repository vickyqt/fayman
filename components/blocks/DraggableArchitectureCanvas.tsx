"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  Handle,
  MarkerType,
  Position,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { PALETTE, useResolvedTheme, type Resolved } from "@/lib/client/theme";
import type { BlockProps, Of } from "./types";

type ArchData = { label: string; selected?: boolean };

function ArchNode({ data }: NodeProps<Node<ArchData>>) {
  return (
    <div className={`archnode ${data.selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      {data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { arch: ArchNode };

type Tone = "ok" | "error" | "neutral" | "blue";

/** React Flow markers need literal colors, so edges are rebuilt when the theme changes. */
function strokeFor(theme: Resolved, tone: Tone): string {
  const p = PALETTE[theme];
  return { ok: p.green, error: p.red, neutral: p.ink, blue: p.blue }[tone];
}

function toEdge(
  theme: Resolved,
  e: { id: string; source: string; target: string; label?: string; status: Tone },
  extra: Partial<Edge> = {},
): Edge {
  const color = strokeFor(theme, e.status);
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    style: { stroke: color, strokeWidth: 2 },
    labelStyle: { fontFamily: "var(--mono)", fontSize: 11, fill: color },
    labelBgStyle: { fill: PALETTE[theme].surface },
    data: { tone: e.status },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
    ...extra,
  };
}

export function DraggableArchitectureCanvas({ block, onState, onCapture }: BlockProps<Of<"architecture">>) {
  const theme = useResolvedTheme();
  const initialNodes = useMemo<Node<ArchData>[]>(
    () => block.nodes.map((n) => ({ id: n.id, type: "arch", position: { x: n.x, y: n.y }, data: { label: n.label } })),
    [block.nodes],
  );
  const initialEdges = useMemo(() => block.edges.map((e) => toEdge(theme, e)), [block.edges, theme]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [sel, setSel] = useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [wrong, setWrong] = useState(0);

  const required = block.challenge?.requiredEdges ?? [];
  const matchReq = (a: string, b: string) =>
    required.find((r) => (r.source === a && r.target === b) || (r.source === b && r.target === a));
  const drawn = required.filter((r) => edges.some((e) => e.id === `req-${r.source}-${r.target}`));
  const solved = required.length > 0 && drawn.length === required.length;

  useEffect(() => {
    onState({
      selected: sel ? (sel.kind === "node" ? block.nodes.find((n) => n.id === sel.id)?.label : sel.id) : "none",
      ...(block.challenge ? { challenge: `${drawn.length}/${required.length} transitions drawn${solved ? " (solved)" : ""}` } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, drawn.length, solved]);

  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, selected: sel?.kind === "node" && sel.id === n.id } })));
  }, [sel, setNodes]);

  // Re-color existing edges (including ones the learner drew) when the theme flips.
  useEffect(() => {
    setEdges((es) =>
      es.map((e) => {
        const tone = ((e.data as { tone?: Tone } | undefined)?.tone ?? "neutral") as Tone;
        return toEdge(theme, { id: e.id, source: e.source, target: e.target, label: e.label as string | undefined, status: tone }, { animated: e.animated });
      }),
    );
  }, [theme, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      const req = matchReq(c.source, c.target);
      if (req) {
        const id = `req-${req.source}-${req.target}`;
        setEdges((es) => (es.some((e) => e.id === id) ? es : [...es, toEdge(theme, { id, source: req.source, target: req.target, status: "ok" }, { animated: true })]));
      } else {
        const id = `bad-${c.source}-${c.target}-${Date.now()}`;
        setWrong((w) => w + 1);
        setEdges((es) => [...es, toEdge(theme, { id, source: c.source!, target: c.target!, label: "not this one", status: "error" })]);
        setTimeout(() => setEdges((es) => es.filter((e) => e.id !== id)), 1600);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [required, setEdges, theme],
  );

  const reset = () => {
    setNodes(initialNodes);
    setEdges(initialEdges);
    setSel(null);
    setWrong(0);
  };

  const selNode = sel?.kind === "node" ? block.nodes.find((n) => n.id === sel.id) : undefined;
  const selEdge = sel?.kind === "edge" ? block.edges.find((e) => e.id === sel.id) : undefined;
  const reqSel = sel?.kind === "edge" && sel.id.startsWith("req-") ? sel.id : undefined;

  return (
    <div>
      <p>{block.description}</p>
      {block.challenge && (
        <div className={solved ? "note-ok" : "insight"} style={{ marginTop: 0, marginBottom: 10 }}>
          <strong>{solved ? "Solved. " : "Challenge. "}</strong>
          {solved ? block.challenge.successMessage : block.challenge.prompt}
          {!solved && (
            <span className="small muted">
              {" "}
              ({drawn.length}/{required.length} drawn{wrong ? `, ${wrong} wrong attempt${wrong > 1 ? "s" : ""}` : ""})
            </span>
          )}
        </div>
      )}
      <div className="flowwrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          onNodeClick={(_, n) => setSel({ kind: "node", id: n.id })}
          onEdgeClick={(_, e) => setSel({ kind: "edge", id: e.id })}
          onPaneClick={() => setSel(null)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.4}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={null}
          colorMode={theme}
        >
          <Background variant={BackgroundVariant.Lines} gap={28} color={PALETTE[theme].line} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="row small muted" style={{ marginTop: 6 }}>
        <span>
          <span style={{ color: "var(--blue)", fontWeight: 700 }}>Blue</span> = draggable. Click a state or arrow for the deep dive.
        </span>
        <span className="spacer" />
        <button className="btn sm" onClick={reset}>
          Reset layout
        </button>
      </div>

      {(selNode || selEdge || reqSel) && (
        <div className="inspector" aria-live="polite">
          <div className="row">
            <strong>
              {selNode?.label ??
                (selEdge
                  ? `${block.nodes.find((n) => n.id === selEdge.source)?.label} → ${block.nodes.find((n) => n.id === selEdge.target)?.label}${selEdge.label ? `: ${selEdge.label}` : ""}`
                  : "Your transition")}
            </strong>
            <span className="spacer" />
            {(selNode || selEdge?.detail) && (
              <button
                className="btn ghost sm"
                onClick={() =>
                  onCapture(
                    selNode
                      ? { title: selNode.label, detail: selNode.detail }
                      : { title: selEdge!.label ?? "Transition", detail: selEdge!.detail ?? "" },
                  )
                }
              >
                ＋ Capture
              </button>
            )}
          </div>
          <p style={{ margin: "6px 0 0" }}>
            {selNode?.detail ?? selEdge?.detail ?? (reqSel ? block.challenge?.successMessage : "No further detail for this transition.")}
          </p>
        </div>
      )}
    </div>
  );
}
