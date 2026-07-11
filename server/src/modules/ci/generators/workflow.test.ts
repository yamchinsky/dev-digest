/**
 * Hermetic unit tests for workflow.ts — generateWorkflowYaml.
 *
 * No DB, no Docker, no network. Covers:
 *   AC-14 — no marketplace `uses:` action for the review step; runner is invoked directly.
 *   AC-14 — permissions block is exactly { contents: read, pull-requests: write }.
 *   AC-15 — OPENROUTER_API_KEY uses the Secrets expression; literal key never in plaintext.
 *   AC-16 — fork-guard `if:` expression is present on the job.
 *   AC-17 — `issue_comment` trigger is absent.
 */
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { generateWorkflowYaml } from './workflow.js';

const defaultOpts = {
  triggers: ['opened', 'synchronize', 'reopened'],
  postAs: 'devdigest-bot',
  base: 'main',
};

describe('generateWorkflowYaml', () => {
  it('produces parseable YAML', () => {
    const yaml = generateWorkflowYaml(defaultOpts);
    expect(() => parse(yaml)).not.toThrow();
  });

  it('AC-14: permissions is exactly { contents: read, pull-requests: write }', () => {
    const wf = parse(generateWorkflowYaml(defaultOpts));
    expect(wf.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
    });
    // No extra keys
    expect(Object.keys(wf.permissions)).toHaveLength(2);
  });

  it('AC-14: review step uses `run: node ...` and no marketplace action for the runner', () => {
    const wf = parse(generateWorkflowYaml(defaultOpts));
    const steps: Array<{ uses?: string; run?: string; name?: string }> =
      wf.jobs.review.steps;
    const runnerStep = steps.find(
      (s) => typeof s.run === 'string' && s.run.includes('.devdigest/runner/index.js'),
    );
    expect(runnerStep).toBeDefined();
    // The runner step must not use a marketplace action
    expect(runnerStep?.uses).toBeUndefined();
  });

  it('AC-15: OPENROUTER_API_KEY value is the Secrets expression (not a literal secret value)', () => {
    const yaml = generateWorkflowYaml(defaultOpts);
    const wf = parse(yaml);
    const envBlock = wf.jobs.review.env as Record<string, string>;
    // Value must be the Secrets expression form — never a literal token.
    expect(envBlock['OPENROUTER_API_KEY']).toBe('${{ secrets.OPENROUTER_API_KEY }}');
    // The value must always start with ${{ secrets.
    expect(envBlock['OPENROUTER_API_KEY']).toMatch(/^\$\{\{ secrets\./);
    // The YAML must NOT contain any raw bearer token pattern (sk-or-*, sk-*, etc.)
    // This guards against accidentally inlining a key value.
    expect(yaml).not.toMatch(/sk-[A-Za-z0-9_-]{10}/);
  });

  it('AC-16: fork-guard `if:` is present on the review job', () => {
    const wf = parse(generateWorkflowYaml(defaultOpts));
    const ifExpr: string = wf.jobs.review.if;
    expect(ifExpr).toBeDefined();
    expect(ifExpr).toContain('github.event.pull_request.head.repo.full_name');
    expect(ifExpr).toContain('github.repository');
  });

  it('AC-17: `issue_comment` trigger is absent anywhere in the document', () => {
    const yaml = generateWorkflowYaml(defaultOpts);
    expect(yaml).not.toContain('issue_comment');
  });

  it('triggers are wired into pull_request.types', () => {
    const triggers = ['opened', 'labeled'];
    const wf = parse(generateWorkflowYaml({ ...defaultOpts, triggers }));
    expect(wf.on.pull_request.types).toEqual(triggers);
  });

  it('DEVDIGEST_POST_AS env reflects the postAs option', () => {
    const wf = parse(generateWorkflowYaml({ ...defaultOpts, postAs: 'ci-reviewer' }));
    expect(wf.jobs.review.env['DEVDIGEST_POST_AS']).toBe('ci-reviewer');
  });

  it('base defaults to main when omitted', () => {
    const wfWithBase = parse(generateWorkflowYaml({ triggers: ['opened'], postAs: 'bot' }));
    expect(wfWithBase.jobs.review.env['BASE_BRANCH']).toBe('main');
  });

  it('result path is pinned identically on both sides: runner env DEVDIGEST_RESULT_PATH === upload-artifact path', () => {
    // These two silently diverged once (runner wrote devdigest-result.json at
    // repo root, upload read .devdigest/result.json) and if-no-files-found
    // swallowed it — no artifact, nothing for /ci-runs/sync to ingest.
    const wf = parse(generateWorkflowYaml(defaultOpts));
    const envPath = wf.jobs.review.env['DEVDIGEST_RESULT_PATH'];
    const steps: Array<{ uses?: string; with?: Record<string, string> }> = wf.jobs.review.steps;
    const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(envPath).toBeTruthy();
    expect(upload?.with?.path).toBe(envPath);
    expect(upload?.with?.name).toBe('devdigest-result');
    expect(upload?.with?.['if-no-files-found']).toBe('warn');
  });
});
