/**
 * Fork patch 11: an ephemeral thread's `write` and `edit` run without a prompt
 * inside its Scratch folder and are refused everywhere else. The check runs in
 * the T3 extension inside OMP, so it ships as plain JavaScript source that the
 * extension embeds and the fork test evaluates as is.
 *
 * Only plain paths are judged. OMP rewrites paths that start with `@`, `:` or
 * `~`, `file://` URLs, internal URLs, quoted paths, hashline `[path#TAG]`
 * headers and unusual spaces before it writes, so any character that could
 * take part in one of those forms is refused rather than mirrored. `edit` is
 * pinned to its replace mode by the settings overlay; its hashline and patch
 * modes carry paths inside free text and are refused.
 */
export const T3_PI_EPHEMERAL_ROOT_ENV = "T3_PI_EPHEMERAL_ROOT";

export const EPHEMERAL_WRITE_GUARD_SOURCE = `\
const EPHEMERAL_WRITE_FIELDS = {
  write: ["path", "content"],
  edit: ["path", "old_string", "new_string", "replace_all"],
};
const EPHEMERAL_PLAIN_PATH = /^[\\p{L}\\p{N}\\p{M}._\\-\\/ ()+,=]+$/u;

async function ephemeralWriteRefusal(fsp, nodePath, root, cwd, toolName, input) {
  const fields = EPHEMERAL_WRITE_FIELDS[toolName];
  if (fields === undefined) return undefined;
  const refusal = toolName + " may only change files inside this ephemeral thread's folder.";
  if (input === null || typeof input !== "object" || Array.isArray(input)) return refusal;
  if (Object.keys(input).some((key) => !fields.includes(key))) return refusal;
  const target = input.path;
  if (typeof target !== "string" || target.trim() !== target || !EPHEMERAL_PLAIN_PATH.test(target)) {
    return refusal;
  }
  let realRoot;
  try {
    realRoot = await fsp.realpath(root);
  } catch {
    return refusal;
  }
  // Resolve the deepest existing ancestor (or the target itself) through
  // symlinks, so a link inside the folder cannot carry the write outside.
  let existing = nodePath.resolve(cwd, target);
  const missing = [];
  let resolved;
  for (;;) {
    try {
      resolved = nodePath.join(await fsp.realpath(existing), ...missing);
      break;
    } catch {
      const parent = nodePath.dirname(existing);
      if (parent === existing) return refusal;
      missing.unshift(nodePath.basename(existing));
      existing = parent;
    }
  }
  const relative = nodePath.relative(realRoot, resolved);
  const escapes = relative === ".." || relative.startsWith(".." + nodePath.sep);
  return relative.length > 0 && !escapes && !nodePath.isAbsolute(relative) ? undefined : refusal;
}
`;
