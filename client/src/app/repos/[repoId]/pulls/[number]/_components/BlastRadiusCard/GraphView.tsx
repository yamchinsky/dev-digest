/* GraphView — SVG node-link graph of the blast radius data.
   Layout: 3 columns → Changed symbols | Callers | Endpoints/Crons.
   Nodes for symbols and callers are clickable to the same GitHub blob URL
   used in TreeView (via githubBlobUrl). Dependency-free: inline SVG, no new packages.

   Receives the same BlastRadius data + repoFullName/headSha the card already
   holds — no extra fetch. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { BlastRadius } from "@devdigest/shared";
import { githubBlobUrl } from "@/utils/github-urls";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Left edge X of each column (symbols=0, callers=1, endpoints/crons=2). */
const COL_X = [12, 210, 408] as const;
/** Width of every node rect. */
const NODE_W = 183;
/** Height of every node rect. */
const NODE_H = 30;
/** Vertical gap between sibling nodes in the same column. */
const ROW_GAP = 10;
/** Total vertical stride per row slot. */
const ROW_STRIDE = NODE_H + ROW_GAP;
/** Total SVG width. */
const SVG_W = 608;
/** Padding above first row and below last row. */
const PAD_TOP = 8;
const PAD_BOT = 16;

// ---------------------------------------------------------------------------
// Node colours (CSS variables + literal fallbacks work in jsdom too)
// ---------------------------------------------------------------------------

const COLORS = {
  symbol: {
    stroke: "var(--accent)",
    fill: "var(--accent-bg)",
    text: "var(--accent-text)",
  },
  caller: {
    stroke: "var(--border-strong)",
    fill: "var(--bg-hover)",
    text: "var(--text-secondary)",
  },
  endpoint: {
    stroke: "#74c476",
    fill: "#0e2318",
    text: "#74c476",
  },
  cron: {
    stroke: "#6baed6",
    fill: "#0f2535",
    text: "#6baed6",
  },
} as const;

type NodeKind = keyof typeof COLORS;

// ---------------------------------------------------------------------------
// Internal data types
// ---------------------------------------------------------------------------

interface GNode {
  id: string;
  /** Display label (truncated). */
  label: string;
  col: 0 | 1 | 2;
  /** Zero-based position within the column. */
  row: number;
  /** GitHub blob URL, present only for symbol/caller nodes when context is available. */
  href?: string;
  kind: NodeKind;
}

interface GEdge {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** Left-edge X of a column. */
function colX(col: 0 | 1 | 2): number {
  return COL_X[col];
}

/** Top-edge Y of a row slot. */
function rowY(row: number): number {
  return PAD_TOP + row * ROW_STRIDE;
}

/** Center-Y of a node in a given row. */
function cy(row: number): number {
  return rowY(row) + NODE_H / 2;
}

/** Cubic bezier path from the right-center of the source node to the
 *  left-center of the target node. */
function bezierPath(
  fromCol: 0 | 1 | 2,
  fromRow: number,
  toCol: 0 | 1 | 2,
  toRow: number,
): string {
  const x1 = colX(fromCol) + NODE_W;
  const y1 = cy(fromRow);
  const x2 = colX(toCol);
  const y2 = cy(toRow);
  const midX = (x1 + x2) / 2;
  return `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

interface GraphData {
  nodes: GNode[];
  edges: GEdge[];
  /** True when there is something to render beyond just symbol nodes. */
  hasDownstream: boolean;
}

function buildGraph(
  data: BlastRadius,
  repoFullName: string | null | undefined,
  headSha: string | null | undefined,
): GraphData {
  const nodes: GNode[] = [];
  const rawEdges: GEdge[] = [];

  // Row counter per column
  const colRows: [number, number, number] = [0, 0, 0];

  // ---------- Column 0: Changed symbols ----------
  const symNodeMap = new Map<string, GNode>();

  for (const sym of data.changed_symbols) {
    const id = `sym:${sym.name}`;
    const href =
      repoFullName && headSha
        ? githubBlobUrl(repoFullName, headSha, sym.file)
        : undefined;
    const node: GNode = {
      id,
      label: truncate(sym.name, 24),
      col: 0,
      row: colRows[0]++,
      href,
      kind: "symbol",
    };
    nodes.push(node);
    symNodeMap.set(sym.name, node);
  }

  // ---------- Column 1: Callers + Column 2: Endpoints/Crons ----------
  const callerNodeMap = new Map<string, GNode>(); // `file:line` → node
  const endpointNodeMap = new Map<string, GNode>();
  const cronNodeMap = new Map<string, GNode>();

  for (const downstream of data.downstream) {
    const symNode = symNodeMap.get(downstream.symbol);

    // Build endpoint/cron nodes for this downstream entry (shared by all callers)
    const epNodes: GNode[] = [];
    for (const ep of downstream.endpoints_affected) {
      let epNode = endpointNodeMap.get(ep);
      if (!epNode) {
        epNode = {
          id: `ep:${ep}`,
          label: truncate(ep, 24),
          col: 2,
          row: colRows[2]++,
          kind: "endpoint",
        };
        nodes.push(epNode);
        endpointNodeMap.set(ep, epNode);
      }
      epNodes.push(epNode);
    }
    const cronNodes: GNode[] = [];
    for (const cron of downstream.crons_affected) {
      let cronNode = cronNodeMap.get(cron);
      if (!cronNode) {
        cronNode = {
          id: `cron:${cron}`,
          label: truncate(cron, 24),
          col: 2,
          row: colRows[2]++,
          kind: "cron",
        };
        nodes.push(cronNode);
        cronNodeMap.set(cron, cronNode);
      }
      cronNodes.push(cronNode);
    }
    const allRightNodes = [...epNodes, ...cronNodes];

    if (downstream.callers.length > 0) {
      for (const caller of downstream.callers) {
        const callerKey = `${caller.file}:${caller.line}`;
        let callerNode = callerNodeMap.get(callerKey);
        if (!callerNode) {
          const href =
            repoFullName && headSha
              ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line)
              : undefined;
          callerNode = {
            id: `caller:${callerKey}`,
            label: truncate(`${caller.file}:${caller.line}`, 24),
            col: 1,
            row: colRows[1]++,
            href,
            kind: "caller",
          };
          nodes.push(callerNode);
          callerNodeMap.set(callerKey, callerNode);
        }

        // Symbol → Caller edge
        if (symNode) {
          rawEdges.push({ from: symNode.id, to: callerNode.id });
        }

        // Caller → Endpoint/Cron edges
        for (const rightNode of allRightNodes) {
          rawEdges.push({ from: callerNode.id, to: rightNode.id });
        }
      }
    } else {
      // No callers — draw Symbol → Endpoint/Cron directly
      for (const rightNode of allRightNodes) {
        if (symNode) {
          rawEdges.push({ from: symNode.id, to: rightNode.id });
        }
      }
    }
  }

  // Deduplicate edges
  const seen = new Set<string>();
  const edges = rawEdges.filter((e) => {
    const key = `${e.from}→${e.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const hasDownstream =
    nodes.some((n) => n.col === 1 || n.col === 2);

  return { nodes, edges, hasDownstream };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GraphViewProps {
  data: BlastRadius;
  repoFullName: string | null | undefined;
  headSha: string | null | undefined;
}

export function GraphView({ data, repoFullName, headSha }: GraphViewProps) {
  const t = useTranslations("blast");

  const { nodes, edges, hasDownstream } = buildGraph(data, repoFullName, headSha);

  if (!hasDownstream) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "12px 0 4px" }}>
        {t("graph.empty")}
      </p>
    );
  }

  // Compute SVG height based on the tallest column
  const maxRows = Math.max(
    ...([0, 1, 2] as const).map(
      (col) =>
        nodes.filter((n) => n.col === col).reduce((m, n) => Math.max(m, n.row + 1), 0),
    ),
  );
  const svgH = PAD_TOP + maxRows * ROW_STRIDE + PAD_BOT;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div
      style={{ overflowX: "auto", marginTop: 4 }}
      role="img"
      aria-label={t("graph.ariaLabel")}
    >
      <svg
        width={SVG_W}
        height={svgH}
        viewBox={`0 0 ${SVG_W} ${svgH}`}
        style={{ display: "block" }}
      >
        {/* Edges — drawn first so nodes appear on top */}
        {edges.map((edge, i) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) return null;
          return (
            <path
              key={i}
              d={bezierPath(from.col, from.row, to.col, to.row)}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.5}
              opacity={0.65}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const x = colX(node.col);
          const y = rowY(node.row);
          const c = COLORS[node.kind];

          const rect = (
            <rect
              x={x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={5}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth={1}
            />
          );
          const label = (
            <text
              x={x + NODE_W / 2}
              y={y + NODE_H / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11}
              fontFamily="var(--font-mono, monospace)"
              fill={c.text}
            >
              {node.label}
            </text>
          );

          if (node.href) {
            return (
              <a
                key={node.id}
                href={node.href}
                target="_blank"
                rel="noreferrer"
                aria-label={node.label}
              >
                <rect
                  x={x}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={5}
                  fill={c.fill}
                  stroke={c.stroke}
                  strokeWidth={1}
                  style={{ cursor: "pointer" }}
                />
                <text
                  x={x + NODE_W / 2}
                  y={y + NODE_H / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontFamily="var(--font-mono, monospace)"
                  fill={c.text}
                  style={{ cursor: "pointer" }}
                >
                  {node.label}
                </text>
              </a>
            );
          }

          return (
            <g key={node.id}>
              {rect}
              {label}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
