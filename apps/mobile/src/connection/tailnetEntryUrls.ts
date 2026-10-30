/**
 * Fork patch 7: build-time servers a phone with no environment probes, so its
 * first server pairs without typing an address. Only `https://host[:port]/`:
 * the certificate checks the name, where an HTTP name is only as trusted as
 * whoever answers DNS. Read by app.config.ts, which fails the build on a bad entry.
 */
export function parseTailnetEntryUrls(raw: string | undefined): ReadonlyArray<string> {
  const entries = (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries.map((entry) => {
    // Checked before `new URL`, which would normalize `https:host`, `/a/..` or `@host` into a valid entry.
    if (!/^https:\/\/[^/?#@\\]+\/?$/.test(entry)) {
      throw new Error(`Tailnet entry ${entry} must be https://host[:port]/ with nothing else.`);
    }
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`Tailnet entry ${entry} is not a URL.`);
    }
    return url.toString();
  });
}
