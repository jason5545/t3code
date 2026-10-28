"use strict";

/**
 * Fork patch 2: rewrites English UI text in display positions into zh-TW runtime calls at build
 * time, so components keep upstream's source. Options: catalogFile, runtimeFile, roots, onMessage
 * (collect mode). Position rules, `untranslated.json` and `displayFiles.json`: patches.md section 2.
 */

const fs = require("node:fs");
const nodePath = require("node:path");

const DISPLAY_ATTRIBUTE =
  /^(?:title|label|description|placeholder|subtitle|detail|message|tooltip|hint|heading|headline|summary|alt|aria-label|aria-description|aria-valuetext|accessibilityLabel|accessibilityHint|ariaLabel)$|[a-z](?:Label|Tooltip|Title|Placeholder|Message|Description|Hint|Reason|Text)$/;
const DISPLAY_PROPERTY =
  /^(?:title|label|description|placeholder|subtitle|tooltip|hint|heading|headline|explanation|accessibilityLabel|accessibilityHint|ariaLabel)$|[a-z](?:Label|Tooltip|Title|Placeholder|Description|Hint)$/;
// Variables and default parameters named for display text, wherever they are declared.
const DISPLAY_VARIABLE = /^(?:placeholder|tooltip)$|[a-z](?:Label|Placeholder|Tooltip)$/;
const DISPLAY_FUNCTION =
  /^[a-z][A-Za-z0-9]*[a-z](?:Label|Title|Subtitle|Placeholder|Tooltip|Description)$/;
// Lookup tables such as `const SORT_ORDER_LABELS = { manual: "Manual" }` that feed menu options.
const DISPLAY_MAP =
  /^(?:labels|titles|descriptions)$|[A-Z_](?:LABELS?|TITLES?|SUBTITLES?|DESCRIPTIONS?|TEXT)$|[a-z](?:Labels?|Titles?|Subtitles?|Descriptions?)$/;
// Context-record fields that reach agents or get parsed back, despite their names.
const DATA_PROPERTIES = new Set(["rangeLabel", "sectionTitle", "terminalLabel"]);
// Toast payloads are display-only, so their body and action text are safe too.
const TOAST_PROPERTY = /^(?:children|message|detail)$/;
const TOAST_METHODS = new Set(["add", "update", "promise"]);
// Mobile's `Dialog.alert` takes `Alert.alert`'s arguments; `Dialog.confirm`/`prompt` take one request object.
const ALERT_CALLS = new Set(["Alert.alert", "Alert.prompt", "Dialog.alert"]);
const DIALOG_REQUEST_CALLS = new Set(["Dialog.confirm", "Dialog.prompt"]);
const DIALOG_REQUEST_PROPERTY = /^(?:message|confirmText|cancelText)$/;
// Toast buttons keep their label in `children`, often built inside a helper such as stackedThreadToast.
const ACTION_PROPS = /^(?:actionProps|secondaryActionProps)$/;
const VERBATIM_ELEMENTS = new Set(["code", "pre", "kbd", "samp", "script", "style", "Kbd"]);
const STRING_CHILD_ELEMENTS = new Set(["option", "title", "textarea"]);
const PLACEHOLDER = /\{([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|\d+)\}/g;
const TEST_FILE = /\.(?:test|browser|stories)\.[cm]?[jt]sx?$|[/\\]test-fixtures\.[jt]sx?$/;
const REPO_ROOT = nodePath.resolve(__dirname, "../..");
const UNTRANSLATED_FILE = nodePath.join(__dirname, "untranslated.json");
const DISPLAY_FILES_FILE = nodePath.join(__dirname, "displayFiles.json");
const DISPLAY_FILE_PROPERTY =
  /^(?:detail|details|message|reason|body|text|error|notice|statusText|warning)$/;
// `const STATES = { open: "Open" }` in a display file is a table of display labels.
const DISPLAY_FILE_TABLE = /^[A-Z][A-Z0-9_]*$/;

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
  if (ALERT_CALLS.has(callee)) return "alert";
  if (DIALOG_REQUEST_CALLS.has(callee)) return "dialog";
  return null;
}

function isDisplayVariable(name) {
  return DISPLAY_VARIABLE.test(name) && !DATA_PROPERTIES.has(name);
}

/** Helpers such as `resolveEnvModeLabel(mode)` whose name says they return display text. */
function isDisplayFunction(functionPath) {
  if (!functionPath) return false;
  let id = functionPath.node.id;
  if (!id && functionPath.parentPath.isVariableDeclarator()) id = functionPath.parentPath.node.id;
  return id?.type === "Identifier" && DISPLAY_FUNCTION.test(id.name);
}

/**
 * Prose such as "Could not read '{name}'." rather than class lists ("flex gap-2"),
 * log lines ("[outbox] retrying") or identifiers: it has a space and starts with
 * a capital, a digit, a quote or a placeholder.
 */
function isSentenceLiteral(node) {
  const text =
    node.type === "StringLiteral"
      ? node.value
      : node.type === "TemplateLiteral"
        ? node.quasis.map((quasi) => quasi.value.cooked ?? "").join("{}")
        : "";
  return /\S\s+\S/.test(text) && /^\s*[A-Z0-9'"“‘{#(]/.test(text);
}

function isActionPropsObject(objectPath) {
  let property = objectPath.parentPath;
  // `actionProps: canUpdate ? { children: "Update" } : { children: "Settings" }`
  while (property?.isConditionalExpression() || property?.isLogicalExpression()) {
    property = property.parentPath;
  }
  if (!property?.isObjectProperty() || property.node.computed) return false;
  const key = property.node.key;
  return ACTION_PROPS.test(key.type === "Identifier" ? key.name : String(key.value));
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
      const replacement = message && translation(state, message, path, kind, "string");
      if (replacement) path.replaceWith(replacement);
      else if (state.displayFile && node.type === "TemplateLiteral") {
        for (const expression of path.get("expressions")) translateValue(state, expression, kind);
      }
      return;
    }
    if (node.type === "ArrayExpression" && state.displayFile) {
      for (const element of path.get("elements")) translateValue(state, element, kind);
    } else if (node.type === "ConditionalExpression") {
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

  /**
   * In display files, sentences handed to helpers (`fail(detail ?? "Stream failed.")`) or
   * assigned to a variable later shown (`error = "Clipboard is empty."`). Single words
   * there are usually identifiers, so only text with a space counts.
   */
  function translateSentences(state, path, kind) {
    const node = path?.node;
    if (!node) return;
    if (node.type === "ConditionalExpression") {
      translateSentences(state, path.get("consequent"), kind);
      translateSentences(state, path.get("alternate"), kind);
    } else if (node.type === "LogicalExpression") {
      translateSentences(state, path.get("left"), kind);
      translateSentences(state, path.get("right"), kind);
    } else if (isSentenceLiteral(node)) {
      translateValue(state, path, kind);
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
      if (DATA_PROPERTIES.has(name)) return;
      const value = path.get("value");
      if (!DISPLAY_ATTRIBUTE.test(name)) {
        // Display files also pass sentences through props such as `value` on settings rows.
        if (!state.displayFile) return;
        if (value.isJSXExpressionContainer())
          return translateSentences(state, value.get("expression"), `attr:${name}`);
        if (!value.isStringLiteral() || !isSentenceLiteral(value.node)) return;
      }
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
      const expression = path.get("expression");
      // Render-prop children such as `<SelectValue>{(value) => value ?? "Mixed"}</SelectValue>`.
      if (expression.isArrowFunctionExpression() && !expression.get("body").isBlockStatement()) {
        translateValue(state, expression.get("body"), "jsx:render");
        return;
      }
      translateValue(state, expression, "jsx:expression");
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
        (state.displayFile && DISPLAY_FILE_PROPERTY.test(key)) ||
        (sink === "toast" && TOAST_PROPERTY.test(key)) ||
        (key === "children" && isActionPropsObject(path.parentPath)) ||
        (sink === "alert" && key === "text") ||
        (sink === "dialog" && DIALOG_REQUEST_PROPERTY.test(key))
      ) {
        translateValue(state, path.get("value"), sink ? `${sink}:${key}` : `prop:${key}`);
      }
    },
    ReturnStatement(path, state) {
      if (state.displayFile || isDisplayFunction(path.getFunctionParent()))
        translateValue(state, path.get("argument"), "return");
    },
    ArrowFunctionExpression(path, state) {
      if ((state.displayFile || isDisplayFunction(path)) && !path.get("body").isBlockStatement())
        translateValue(state, path.get("body"), "return");
    },
    VariableDeclarator(path, state) {
      const id = path.node.id;
      // `const footerActionLabel = ... ? "Create" : "Select"` names its own display role.
      if (state.displayFile || (id.type === "Identifier" && isDisplayVariable(id.name)))
        translateValue(state, path.get("init"), "variable");
      else if (isDisplayFunction(path.getFunctionParent()))
        translateValue(state, path.get("init"), "helper-variable");
      const map = id.type === "Identifier" && DISPLAY_MAP.test(id.name);
      // Constant tables also hold icon names and ids, so only capitalized labels count there.
      const table =
        !map && state.displayFile && id.type === "Identifier" && DISPLAY_FILE_TABLE.test(id.name);
      if (map || table) {
        let init = path.get("init");
        while (init.isTSAsExpression() || init.isTSSatisfiesExpression())
          init = init.get("expression");
        if (init.isObjectExpression()) {
          for (const property of init.get("properties")) {
            if (!property.isObjectProperty()) continue;
            const value = property.get("value");
            if (map || (value.isStringLiteral() && /^[A-Z]/.test(value.node.value)))
              translateValue(state, value, "map");
          }
        }
      }
    },
    AssignmentPattern(path, state) {
      // Default props such as `escapeLabel = "Close"`.
      const left = path.node.left;
      if (left.type === "Identifier" && isDisplayVariable(left.name))
        translateValue(state, path.get("right"), "default");
      else if (state.displayFile) translateSentences(state, path.get("right"), "default");
    },
    ArrayExpression(path, state) {
      // Lists of lines joined for display, such as `[label, inUse ? "In use" : null]`.
      // Skip the part arrays of a runtime call this plugin already produced.
      if (state.displayFile && !path.parentPath.node._t3i18n) {
        for (const element of path.get("elements")) translateSentences(state, element, "array");
      }
    },
    AssignmentExpression(path, state) {
      if (state.displayFile && path.node.operator === "=")
        translateSentences(state, path.get("right"), "assignment");
    },
    CallExpression(path, state) {
      const callee = calleePath(path.node.callee);
      const args = path.get("arguments");
      if (ALERT_CALLS.has(callee)) {
        translateValue(state, args[0], "alert:title");
        translateValue(state, args[1], "alert:message");
      } else if (/^(?:window\.)?(?:confirm|alert)$/.test(callee)) {
        translateValue(state, args[0], "dialog");
      } else if (state.displayFile && !path.node._t3i18n) {
        for (const arg of args) translateSentences(state, arg, "argument");
      }
    },
    // `throw new Error("…")` in a display file carries text a toast shows as is.
    NewExpression(path, state) {
      if (!state.displayFile) return;
      for (const arg of path.get("arguments")) translateSentences(state, arg, "argument");
    },
  };

  return {
    name: "t3-auto-translate",
    visitor: {
      Program(programPath, pass) {
        const filename = (pass.filename ?? pass.file.opts.filename ?? "").replace(/\?.*$/, "");
        if (!isTranslatableFile(filename, options)) return;
        const keepEnglish = readJson(UNTRANSLATED_FILE, {}).files ?? {};
        const relativeFile = nodePath.relative(REPO_ROOT, filename).replace(/\\/g, "/");
        const state = {
          filename,
          displayFile: (readJson(DISPLAY_FILES_FILE, {}).files ?? []).includes(relativeFile),
          used: new Set(),
          catalog: collect ? {} : readJson(options.catalogFile, {}),
          keepEnglish: new Set(keepEnglish[relativeFile] ?? []),
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
