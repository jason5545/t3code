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
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`Tailnet entry ${entry} is not a URL.`);
    }
    if (
      url.protocol !== "https:" ||
      url.hostname === "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      // `new URL` drops an empty `?` or `#`, so look at the text itself.
      entry.includes("?") ||
      entry.includes("#")
    ) {
      throw new Error(`Tailnet entry ${entry} must be https://host[:port]/ with nothing else.`);
    }
    return url.toString();
  });
}
