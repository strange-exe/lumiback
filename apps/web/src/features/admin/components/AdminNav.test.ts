import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import ts from "typescript";

/**
 * The office's section tabs never prefetch (owner, 2026-11-27). With Next's default, every tab
 * in view was prefetched on each page load and again after each auto-refresh, and each of those
 * requests ran the office layout's sign-in check: 5 of the 11 API calls an office page made
 * (.claude/verify/calls/calls-per-page.md). prefetch={false} stops it both on entering the
 * viewport and on hover (next/dist/docs/01-app/03-api-reference/02-components/link.md).
 *
 * Next prefetches only in a production build, and the e2e suite runs `next dev`, so no browser
 * test there can see this. The guard reads the component's own source instead: every next/link
 * element in AdminNav must say prefetch={false}, with nothing spread over it.
 */
const SOURCE = ts.createSourceFile(
  "AdminNav.tsx",
  readFileSync(new URL("./AdminNav.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

/** The local name AdminNav gives next/link's default export. */
function linkName(): string {
  for (const statement of SOURCE.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "next/link" &&
      statement.importClause?.name
    ) {
      return statement.importClause.name.text;
    }
  }
  throw new Error("AdminNav no longer imports next/link");
}

type LinkElement = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function linkElements(): LinkElement[] {
  const name = linkName();
  const found: LinkElement[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(SOURCE) === name
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(SOURCE);
  return found;
}

/** "prefetch={false}" when the element turns prefetching off, else what it says instead. */
function prefetchOf(element: LinkElement): string {
  const attributes = element.attributes.properties;
  if (attributes.some(ts.isJsxSpreadAttribute)) return "a spread that could set prefetch";
  const prefetch = attributes.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(SOURCE) === "prefetch",
  );
  if (!prefetch) return "no prefetch prop (the default prefetches)";
  const value = prefetch.initializer;
  if (value && ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.FalseKeyword) {
    return "prefetch={false}";
  }
  return prefetch.getText(SOURCE);
}

test("the office nav's section tabs are next/link elements", () => {
  assert.ok(linkElements().length > 0, "found no <Link> in AdminNav");
});

test("no office section tab prefetches", () => {
  for (const element of linkElements()) {
    const { line } = SOURCE.getLineAndCharacterOfPosition(element.getStart(SOURCE));
    assert.equal(prefetchOf(element), "prefetch={false}", `the <Link> on AdminNav.tsx:${line + 1}`);
  }
});
