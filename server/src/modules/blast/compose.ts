import type { BlastRadius, DownstreamImpact, PriorPr } from '@devdigest/shared';
import type { BlastResult, IndexState } from '../repo-intel/types.js';

/**
 * Pure mapper: BlastResult (repo-intel facade) + IndexState + priorPrs
 * → BlastRadius (the shared contract for GET /pulls/:id/blast).
 *
 * No I/O, no side effects. All empty / degraded inputs produce a valid
 * BlastRadius — never throws, never returns an inconsistent shape.
 */
export function composeBlast(
  blast: BlastResult,
  state: IndexState,
  priorPrs: PriorPr[],
): BlastRadius {
  const changed_symbols = blast.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  // One DownstreamImpact per changed symbol.
  // Group callers by `viaSymbol` (which changed symbol they reach), then
  // attribute endpoints/crons from `factsByFile` when the persistent index
  // is available, or fall back to `impactedEndpoints` on the degraded path.
  const downstream: DownstreamImpact[] = blast.changedSymbols.map((sym) => {
    const symCallers = blast.callers.filter((c) => c.viaSymbol === sym.name);
    const callers = symCallers.map((c) => ({
      name: c.symbol,
      file: c.file,
      line: c.line,
    }));

    const callerFileSet = new Set(symCallers.map((c) => c.file));

    let endpoints_affected: string[];
    let crons_affected: string[];

    if (blast.factsByFile) {
      // Persistent index path: per-file attribution is available.
      const endpointSet = new Set<string>();
      const cronSet = new Set<string>();
      for (const file of callerFileSet) {
        const facts = blast.factsByFile[file];
        if (facts) {
          for (const e of facts.endpoints) endpointSet.add(e);
          for (const c of facts.crons) cronSet.add(c);
        }
      }
      endpoints_affected = [...endpointSet];
      crons_affected = [...cronSet];
    } else {
      // Degraded / ripgrep path: no per-file attribution; use the flat union
      // of impactedEndpoints for any symbol that has callers. Symbols with
      // zero callers get empty arrays (avoid false-positives).
      endpoints_affected = callers.length > 0 ? blast.impactedEndpoints : [];
      crons_affected = [];
    }

    return { symbol: sym.name, callers, endpoints_affected, crons_affected };
  });

  // Deterministic summary: "<N> symbols · <N> callers · <N> endpoints (index: <status>)"
  const symCount = changed_symbols.length;
  const callerCount = blast.callers.length;
  const endpointCount = new Set(blast.impactedEndpoints).size;
  const summary =
    `${symCount} symbol${symCount !== 1 ? 's' : ''} · ` +
    `${callerCount} caller${callerCount !== 1 ? 's' : ''} · ` +
    `${endpointCount} endpoint${endpointCount !== 1 ? 's' : ''} ` +
    `(index: ${state.status})`;

  // status + degraded_reason come from the index state, not from BlastResult.
  const status = state.status;
  const degraded_reason: string | null =
    state.status !== 'full'
      ? (state.degradedReason ?? state.reason ?? null)
      : null;

  return {
    changed_symbols,
    downstream,
    summary,
    status,
    degraded_reason,
    prior_prs: priorPrs,
  };
}
