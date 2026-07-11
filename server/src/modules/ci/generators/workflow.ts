import { stringify } from 'yaml';
import { RESULT_ARTIFACT_NAME, RESULT_FILE_PATH, RUNNER_PATH } from '../constants.js';

export interface WorkflowOpts {
  /** PR event types that trigger the review (e.g. ['opened', 'synchronize', 'reopened']). */
  triggers: string[];
  /** The login whose token is used to post GitHub reviews (DEVDIGEST_POST_AS). */
  postAs: string;
  /** Base branch of the repository (default: 'main'). */
  base?: string;
}

/**
 * Generate a GitHub Actions workflow YAML that runs the devdigest agent-runner
 * on every matching pull-request event.
 *
 * Security contract (AC-14..17):
 *  - `permissions` is exactly `{ contents: read, pull-requests: write }` — nothing else.
 *  - No `issue_comment` trigger — runners must not be triggered by PR comments.
 *  - Fork guard: `jobs.review.if` ensures the workflow only runs on PRs from
 *    the repository itself (prevents secret exfiltration by forked PRs).
 *  - OPENROUTER_API_KEY is read from a GitHub Secret (never inlined).
 */
export function generateWorkflowYaml(opts: WorkflowOpts): string {
  const { triggers, postAs, base = 'main' } = opts;

  const workflow = {
    name: 'DevDigest Review',

    on: {
      pull_request: {
        types: triggers,
      },
    },

    permissions: {
      contents: 'read',
      'pull-requests': 'write',
    },

    jobs: {
      review: {
        // Fork guard (AC-16): only run on PRs from the same repo.
        if: 'github.event.pull_request.head.repo.full_name == github.repository',
        'runs-on': 'ubuntu-latest',

        env: {
          // Secret ref — the literal key never appears in plaintext (AC-15).
          OPENROUTER_API_KEY: '${{ secrets.OPENROUTER_API_KEY }}',
          // Identifies the GitHub account used to post the review comment.
          DEVDIGEST_POST_AS: postAs,
          // Expose context env vars for the runner.
          GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
          BASE_BRANCH: base,
          // Pin the runner's output to the SAME path the upload step reads —
          // the runner's cwd default and the upload path diverged once, and
          // `if-no-files-found` silently dropped the artifact.
          DEVDIGEST_RESULT_PATH: RESULT_FILE_PATH,
        },

        steps: [
          {
            name: 'Checkout',
            uses: 'actions/checkout@v4',
          },
          {
            name: 'Run DevDigest Review',
            // No marketplace action — run the bundled runner directly (AC-14).
            run: `node ${RUNNER_PATH}`,
          },
          {
            name: 'Upload result artifact',
            uses: 'actions/upload-artifact@v4',
            if: 'always()',
            with: {
              name: RESULT_ARTIFACT_NAME,
              path: RESULT_FILE_PATH,
              // 'warn' (not 'ignore'): a missing result file must at least
              // leave a log trace — 'ignore' hid the path mismatch entirely.
              'if-no-files-found': 'warn',
            },
          },
        ],
      },
    },
  };

  return stringify(workflow, { lineWidth: 0 });
}
