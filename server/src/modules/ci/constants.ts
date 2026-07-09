/**
 * CI module constants — paths and identifiers shared by the generator,
 * the service, and the agent-runner.
 */

/** Branch name where the CI bundle is committed. */
export const CI_BRANCH = 'devdigest/ci';

/** The workflow filename the runner uses (also the key for listing runs). */
export const RUNNER_WORKFLOW_FILE = 'devdigest-review.yml';

/** Directory where agent manifests are stored (.devdigest/agents/<slug>.yaml). */
export const MANIFEST_DIR = '.devdigest/agents';

/** Directory where skill bodies are stored (.devdigest/skills/<slug>.md). */
export const SKILLS_DIR = '.devdigest/skills';

/** Path to the bundled agent-runner entry point. */
export const RUNNER_PATH = '.devdigest/runner/index.js';

/** Path to the in-repo memory JSONL file the runner reads/writes. */
export const MEMORY_PATH = '.devdigest/memory.jsonl';

/** Name of the GitHub Actions artifact uploaded by the runner. */
export const RESULT_ARTIFACT_NAME = 'devdigest-result';
