/** Read a File as base64 (no data: prefix). Browser-side; runs on the import
 *  dialog's submit so the server gets a tidy JSON envelope. */
export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // For ~1 MB inputs this is fine. For larger we'd switch to chunked, but
  // the server caps imports at ~1 MB compressed anyway.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

/** Quick filename-ext guard so the dialog doesn't even try to upload .pdf etc. */
export function isAcceptedFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".zip")
  );
}
