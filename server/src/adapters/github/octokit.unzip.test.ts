/**
 * Hermetic unit tests for unzipFirstJson — the artifact-zip reader behind
 * GitHubClient.downloadArtifact.
 *
 * The streaming fixture is a REAL `actions/upload-artifact@v4` zip (run
 * 29148717630 in yamchinsky/devwatch-nest): general-purpose bit 3 set,
 * `compressed size = 0` in the LOCAL header, real sizes only in the data
 * descriptor / central directory. The original local-header-only parser
 * sliced 0 bytes and threw "unexpected end of file" on every real GitHub
 * artifact — sizes must come from the central directory.
 */
import { describe, it, expect } from 'vitest';
import { unzipFirstJson } from './octokit.js';

// Real GitHub Actions artifact zip (streaming, data-descriptor, deflate).
const STREAMING_ZIP_B64 =
  'UEsDBBQACAAIAGxQ61wAAAAAAAAAAAAAAAAVAAAAZGV2ZGlnZXN0LXJlc3VsdC5qc29uPc5RCsIwDAbg950i5FmkW1Wwx3AHKLWLJeA6SdsNEe8u7cDHfH/Cn08HgA+OE8eQrF9KzGhgOFT2wpm9e6KBvsHmJHIM/zmVEChlXiIaUPvNkrItaapwVEpppc/61KKpiKu7dk5oQOvrcGnuArVSHMkX4fyGG61MGwm2fCVJewX2u7zExjLfSeqr3bf7AVBLBwi8pye/jgAAAMUAAABQSwECLQMUAAgACABsUOtcvKcnv44AAADFAAAAFQAAAAAAAAAAACAApIEAAAAAZGV2ZGlnZXN0LXJlc3VsdC5qc29uUEsFBgAAAAABAAEAQwAAANEAAAAAAA==';

// Classic zip (sizes in the local header, no data descriptor) — the fallback path.
const CLASSIC_ZIP_B64 =
  'UEsDBBQAAAAIADtp61yRHQWJPwAAAEAAAAAVAAAAZGV2ZGlnZXN0LXJlc3VsdC5qc29uq1ZKy8xLycxLL45Pzi/NK1GyMtJRSkxPBbGUglOTS4sySyoVglLLMlPLU4uUdJSS84tL4kuLU5Ss8kpzcmoBUEsBAhQDFAAAAAgAO2nrXJEdBYk/AAAAQAAAABUAAAAAAAAAAAAAAIABAAAAAGRldmRpZ2VzdC1yZXN1bHQuanNvblBLBQYAAAAAAQABAEMAAAByAAAAAAA=';

describe('unzipFirstJson', () => {
  it('reads a real actions/upload-artifact@v4 streaming zip (local header says size 0)', async () => {
    const buf = Buffer.from(STREAMING_ZIP_B64, 'base64');
    // Regression guard: the local header must actually carry csize=0 —
    // otherwise this fixture no longer covers the streaming case.
    expect(buf.readUInt32LE(18)).toBe(0);

    const json = JSON.parse(await unzipFirstJson(buf));
    expect(json.agent).toBe('Security Reviewer');
    expect(json.findings_count).toBe(2);
    expect(json.pr_number).toBe(2);
  });

  it('reads a classic zip with sizes in the local header', async () => {
    const json = JSON.parse(await unzipFirstJson(Buffer.from(CLASSIC_ZIP_B64, 'base64')));
    expect(json.agent).toBe('Security Reviewer');
    expect(json.findings_count).toBe(2);
  });

  it('throws when the archive holds no JSON entry', async () => {
    await expect(unzipFirstJson(Buffer.from('not a zip at all'))).rejects.toThrow(
      /no valid JSON/,
    );
  });
});
