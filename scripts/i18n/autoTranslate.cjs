"use strict";

/**
 * Build-time interface translation for the fork's zh-TW locale.
 *
 * Components keep upstream's English source. This Babel plugin finds English
 * UI text in display positions (JSX text, display attributes and object
 * properties, toast and alert calls) and, when the catalog has a translation,
 * replaces it with a runtime call that carries both languages. Syncing
 * upstream therefore never conflicts with translated component code; new
 * upstream text stays English until `node scripts/i18n/extract.ts` lists it.
 *
 * Options:
 * - catalogFile: absolute path of the `{ english: translation }` JSON catalog.
 * - runtimeFile: absolute path of the app module exporting `__t3_t`,
 *   `__t3_tf` and `__t3_tj`.
 * - roots: absolute directories whose files are translated.
 * - onMessage: collect mode. Receives every candidate and transforms nothing.
 *
 * `untranslated.json` beside this file keeps text English: `everywhere` for
 * names and identifiers, `files` for positions whose value code compares
 * against the English literal (translating them would change behavior).
 */

const fs = require("node:fs");
const nodePath = require("node:path");

const DISPLAY_ATTRIBUTE =
  /^(?:title|label|description|placeholder|subtitle|detail|message|tooltip|hint|heading|headline|summary|alt|aria-label|aria-description|aria-valuetext|accessibilityLabel|accessibilityHint|ariaLabel)$|[a-z](?:Label|Tooltip|Title|Placeholder|Message|Description|Hint|Reason|Text)$/;
const DISPLAY_PROPERTY =
  /^(?:title|label|description|placeholder|subtitle|tooltip|hint|heading|headline|accessibilityLabel|accessibilityHint|ariaLabel)$|[a-z](?:Label|Tooltip|Title|Placeholder|Description|Hint)$/;
// Context-record fields that reach agents or get parsed back, despite their names.
const DATA_PROPERTIES = new Set(["rangeLabel", "sectionTitle", "terminalLabel"]);
// Toast payloads are display-only, so their body and action text are safe too.
const TOAST_PROPERTY = /^(?:children|message|detail)$/;
const TOAST_METHODS = new Set(["add", "update", "promise"]);
const VERBATIM_ELEMENTS = new Set(["code", "pre", "kbd", "samp", "script", "style", "Kbd"]);
const STRING_CHILD_ELEMENTS = new Set(["option", "title", "textarea"]);
const PLACEHOLDER = /\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|\d+)\}/g;
const TEST_FILE = /\.(?:test|browser|stories)\.[cm]?[jt]sx?$|[/\\]test-fixtures\.[jt]sx?$/;
const REPO_ROOT = nodePath.resolve(__dirname, "../..");
const UNTRANSLATED_FILE = nodePath.join(__dirname, "untranslated.json");

const jsonCache = new Map();

/** Reads a JSON file once per modification so dev servers pick up catalog edits. */
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  const { mtimeMs } = fs.statSync(file);
  const cached = jsonCache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.value;
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  jsonCache.set(file, { mtimeMs, value });
  return value;
}

/** Babel's JSX whitespace rule: drop line-edge indentation and blank lines. */
function cleanJsxText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (/[^ \t]/.test(lines[index])) lastNonEmptyLine = index;
  }
  let text = "";
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].replace(/\t/g, " ");
    if (index !== 0) line = line.replace(/^[ ]+/, "");
    if (index !== lines.length - 1) line = line.replace(/[ ]+$/, "");
    if (line) {
      if (index !== lastNonEmptyLine) line += " ";
      text += line;
    }
  }
  return text;
}

/** A readable placeholder name for simple identifiers and property paths. */
function describe(node) {
  if (!node) return null;
  if (node.type === "Identifier") return node.name === "undefined" ? null : node.name;
  if (node.type === "TSNonNullExpression") return describe(node.expression);
  if (
    (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
    !node.computed &&
    node.property.type === "Identifier"
  ) {
    const object = describe(node.object);
    return object ? `${object}.${node.property.name}` : null;
  }
  return null;
}

/**
 * Turn text and expression segments into a catalog key. Edge whitespace stays
 * outside the key so `" Save "` and `"Save"` share one translation.
 */
function buildMessage(segments) {
  const names = new Map();
  const values = [];
  let unnamed = 0;
  let body = "";
  for (const segment of segments) {
    if (typeof segment === "string") {
      if (/[{}]/.test(segment)) return null;
      body += segment;
      continue;
    }
    // The same identifier or property path twice is one value; anything else is numbered.
    let name = describe(segment);
    if (name === null) {
      name = String(unnamed);
      unnamed += 1;
    }
    if (!names.has(name)) {
      names.set(name, values.length);
      values.push(segment);
    }
    body += `{${name}}`;
  }
  const text = segments.filter((segment) => typeof segment === "string").join("");
  if (!/[A-Za-z]{2,}/.test(text)) return null;
  const leading = body.match(/^\s*/)[0];
  const trailing = body.slice(leading.length).match(/\s*$/)[0];
  const key = body.slice(leading.length, body.length - trailing.length);
  return { key, leading, trailing, names, values };
}

/**
 * Compile a template into literal strings and value indexes, or null if it
 * names an unknown value. A translation may drop a value such as an English
 * plural suffix; every value is still evaluated.
 */
function compileTemplate(template, names) {
  const parts = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const index = names.get(match[1]);
    if (index === undefined) return null;
    if (match.index > last) parts.push(template.slice(last, match.index));
    parts.push(index);
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push(template.slice(last));
  return parts;
}

function isTranslatableFile(filename, options) {
  if (!filename || filename.includes(`${nodePath.sep}node_modules${nodePath.sep}`)) return false;
  if (TEST_FILE.test(filename)) return false;
  if (options.runtimeFile && nodePath.dirname(filename) === nodePath.dirname(options.runtimeFile)) {
    return false;
  }
  return (options.roots ?? []).some((root) => filename.startsWith(root + nodePath.sep));
}

function calleePath(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (
    (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
    !node.computed
  ) {
    const object = calleePath(node.object);
    return object ? `${object}.${node.property.name}` : "";
  }
  return "";
}

/** The display call a literal is nested in, looking through nested object and array literals. */
function enclosingSink(path) {
  let current = path.parentPath;
  while (
    current &&
    (current.isObjectExpression() ||
      current.isObjectProperty() ||
      current.isArrayExpression() ||
      current.isConditionalExpression() ||
      current.isLogicalExpression())
  ) {
    current = current.parentPath;
  }
  if (!current || !current.isCallExpression()) return null;
  const callee = calleePath(current.node.callee);
  const [object, method] = [
    callee.slice(0, callee.lastIndexOf(".")),
    callee.slice(callee.lastIndexOf(".") + 1),
  ];
  if (/(?:^|\.)toastManager$/.test(object) && TOAST_METHODS.has(method)) return "toast";
  if (callee === "Alert.alert" || callee === "Alert.prompt") return "alert";
  return null;
}

module.exports = function autoTranslate(babel, options) {
  const t = babel.types;
  const collect = typeof options.onMessage === "function";

  function report(state, message, path, kind) {
    options.onMessage({
      key: message.key,
      file: state.filename,
      line: path.node.loc?.start.line ?? 0,
      kind,
    });
  }

  function runtimeCall(state, name, args) {
    state.used.add(name);
    const call = t.callExpression(t.identifier(name), args);
    call._t3i18n = true;
    return call;
  }

  function partsNode(parts, message) {
    const all = [message.leading, ...parts, message.trailing].filter((part) => part !== "");
    return t.arrayExpression(
      all.map((part) =>
        typeof part === "number" ? t.numericLiteral(part) : t.stringLiteral(part),
      ),
    );
  }

  /** Builds the replacement expression, or null when the catalog has no usable translation. */
  function translation(state, message, path, kind, output) {
    if (collect) {
      report(state, message, path, kind);
      return null;
    }
    if (!Object.hasOwn(state.catalog, message.key) || state.keepEnglish.has(message.key))
      return null;
    const translated = state.catalog[message.key];
    if (message.values.length === 0) {
      if (/[{}]/.test(translated)) return null;
      let call = runtimeCall(state, "__t3_t", [
        t.stringLiteral(message.key),
        t.stringLiteral(translated),
      ]);
      if (message.leading) call = t.binaryExpression("+", t.stringLiteral(message.leading), call);
      if (message.trailing) call = t.binaryExpression("+", call, t.stringLiteral(message.trailing));
      return call;
    }
    const english = compileTemplate(message.key, message.names);
    const chinese = compileTemplate(translated, message.names);
    if (!english || !chinese) {
      console.warn(`[t3 i18n] placeholder mismatch, kept English: ${JSON.stringify(message.key)}`);
      return null;
    }
    return runtimeCall(state, output === "node" ? "__t3_tj" : "__t3_tf", [
      partsNode(english, message),
      partsNode(chinese, message),
      t.arrayExpression(message.values),
    ]);
  }

  /** Translate a string-valued expression: literals, templates, and conditional branches. */
  function translateValue(state, path, kind) {
    if (!path?.node || path.node._t3i18n) return;
    const node = path.node;
    if (node.type === "StringLiteral" || node.type === "TemplateLiteral") {
      if (node.type === "TemplateLiteral" && path.parentPath.isTaggedTemplateExpression()) return;
      const segments =
        node.type === "StringLiteral"
          ? [node.value]
          : node.quasis
              .flatMap((quasi, index) =>
                index < node.expressions.length
                  ? [quasi.value.cooked ?? "", node.expressions[index]]
                  : [quasi.value.cooked ?? ""],
              )
              .filter((segment) => segment !== "");
      const message = buildMessage(segments);
      if (!message) return;
      const replacement = translation(state, message, path, kind, "string");
      if (replacement) path.replaceWith(replacement);
      return;
    }
    if (node.type === "ConditionalExpression") {
      translateValue(state, path.get("consequent"), kind);
      translateValue(state, path.get("alternate"), kind);
    } else if (node.type === "LogicalExpression") {
      translateValue(state, path.get("left"), kind);
      translateValue(state, path.get("right"), kind);
    } else if (
      node.type === "TSAsExpression" ||
      node.type === "TSSatisfiesExpression" ||
      node.type === "TSNonNullExpression" ||
      node.type === "ParenthesizedExpression"
    ) {
      translateValue(state, path.get("expression"), kind);
    }
  }

  function elementName(node) {
    if (node.type !== "JSXElement") return "";
    const name = node.openingElement.name;
    return name.type === "JSXIdentifier" ? name.name : "";
  }

  /** Combine an element's text and inline children into one message so word order can change. */
  function translateChildren(state, path) {
    const node = path.node;
    const tag = elementName(node);
    if (VERBATIM_ELEMENTS.has(tag)) return;
    const segments = [];
    for (const child of node.children) {
      if (child.type === "JSXSpreadChild") return;
      let segment;
      if (child.type === "JSXText") segment = cleanJsxText(child.value);
      else if (child.type === "JSXExpressionContainer") {
        if (child.expression.type === "JSXEmptyExpression") continue;
        segment =
          child.expression.type === "StringLiteral" ? child.expression.value : child.expression;
      } else segment = child;
      if (segment === "") continue;
      const previous = segments[segments.length - 1];
      if (typeof segment === "string" && typeof previous === "string")
        segments[segments.length - 1] += segment;
      else segments.push(segment);
    }
    if (!segments.some((segment) => typeof segment === "string")) return;
    const message = buildMessage(segments);
    if (!message) return;
    const output =
      STRING_CHILD_ELEMENTS.has(tag) || message.values.length === 0 ? "string" : "node";
    const replacement = translation(state, message, path, `jsx:${tag || "fragment"}`, output);
    if (replacement) node.children = [t.jsxExpressionContainer(replacement)];
  }

  const visitor = {
    JSXAttribute(path, state) {
      const name = path.node.name.type === "JSXIdentifier" ? path.node.name.name : "";
      if (!DISPLAY_ATTRIBUTE.test(name) || DATA_PROPERTIES.has(name)) return;
      const value = path.get("value");
      if (value.isStringLiteral()) {
        const message = buildMessage([value.node.value]);
        if (!message) return;
        const replacement = translation(state, message, value, `attr:${name}`, "string");
        if (replacement) value.replaceWith(t.jsxExpressionContainer(replacement));
      } else if (value.isJSXExpressionContainer()) {
        translateValue(state, value.get("expression"), `attr:${name}`);
      }
    },
    JSXExpressionContainer(path, state) {
      if (!path.parentPath.isJSXElement() && !path.parentPath.isJSXFragment()) return;
      // Plain string children join their siblings' message in translateChildren.
      if (path.get("expression").isStringLiteral()) return;
      translateValue(state, path.get("expression"), "jsx:expression");
    },
    JSXElement: { exit: (path, state) => translateChildren(state, path) },
    JSXFragment: { exit: (path, state) => translateChildren(state, path) },
    ObjectProperty(path, state) {
      if (path.node.computed || !path.parentPath.isObjectExpression()) return;
      const key = path.node.key.type === "Identifier" ? path.node.key.name : path.node.key.value;
      if (typeof key !== "string") return;
      const sink = enclosingSink(path);
      if (DATA_PROPERTIES.has(key)) return;
      if (
        DISPLAY_PROPERTY.test(key) ||
        (sink === "toast" && TOAST_PROPERTY.test(key)) ||
        (sink === "alert" && key === "text")
      ) {
        translateValue(state, path.get("value"), sink ? `${sink}:${key}` : `prop:${key}`);
      }
    },
    CallExpression(path, state) {
      const callee = calleePath(path.node.callee);
      const args = path.get("arguments");
      if (callee === "Alert.alert" || callee === "Alert.prompt") {
        translateValue(state, args[0], "alert:title");
        translateValue(state, args[1], "alert:message");
      } else if (/^(?:window\.)?(?:confirm|alert)$/.test(callee)) {
        translateValue(state, args[0], "dialog");
      }
    },
  };

  return {
    name: "t3-auto-translate",
    visitor: {
      Program(programPath, pass) {
        const filename = (pass.filename ?? pass.file.opts.filename ?? "").replace(/\?.*$/, "");
        if (!isTranslatableFile(filename, options)) return;
        const keepEnglish = readJson(UNTRANSLATED_FILE, {}).files ?? {};
        const state = {
          filename,
          used: new Set(),
          catalog: collect ? {} : readJson(options.catalogFile, {}),
          keepEnglish: new Set(
            keepEnglish[nodePath.relative(REPO_ROOT, filename).replace(/\\/g, "/")] ?? [],
          ),
        };
        programPath.traverse(visitor, state);
        if (state.used.size === 0) return;
        let source = nodePath
          .relative(nodePath.dirname(filename), options.runtimeFile)
          .replace(/\\/g, "/")
          .replace(/\.[cm]?[jt]sx?$/, "");
        if (!source.startsWith(".")) source = `./${source}`;
        programPath.unshiftContainer(
          "body",
          t.importDeclaration(
            [...state.used]
              .sort()
              .map((name) => t.importSpecifier(t.identifier(name), t.identifier(name))),
            t.stringLiteral(source),
          ),
        );
      },
    },
  };
};

module.exports.cleanJsxText = cleanJsxText;
module.exports.compileTemplate = compileTemplate;
