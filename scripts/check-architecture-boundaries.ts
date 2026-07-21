import * as Fs from "node:fs";
import * as Path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const REPOSITORY_ROOT = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_PRODUCTION_LINES = 500;
const SOURCE_ROOTS = ["apps", "packages", "scripts"] as const;

const FROZEN_OVERSIZED_FILES = new Map<
  string,
  { readonly maxLines: number; readonly reason: string }
>([
  [
    "apps/server/src/provider/Layers/OpenCodeAdapter.ts",
    { maxLines: 4_576, reason: "frozen non-target OpenCode adapter" },
  ],
  [
    "apps/server/src/provider/opencodeRuntime.ts",
    { maxLines: 1_419, reason: "frozen OpenCode/Kilo runtime" },
  ],
  [
    "apps/server/src/provider/Layers/AntigravityAdapter.ts",
    { maxLines: 1_090, reason: "frozen non-target Antigravity adapter" },
  ],
  [
    "apps/server/src/git/Layers/OpenCodeTextGeneration.ts",
    { maxLines: 735, reason: "frozen OpenCode/Kilo text-generation runtime" },
  ],
  [
    "packages/effect-acp/src/protocol.ts",
    { maxLines: 786, reason: "frozen non-target ACP substrate" },
  ],
  [
    "packages/effect-acp/src/client.ts",
    { maxLines: 569, reason: "frozen non-target ACP substrate" },
  ],
  [
    "packages/effect-acp/src/agent.ts",
    { maxLines: 521, reason: "frozen non-target ACP substrate" },
  ],
]);

function repositoryPath(absolutePath: string): string {
  return Path.relative(REPOSITORY_ROOT, absolutePath).split(Path.sep).join("/");
}

function isIgnoredSource(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const fileName = segments.at(-1) ?? "";
  return (
    segments.some((segment) =>
      [
        "node_modules",
        "dist",
        "dist-electron",
        ".turbo",
        "_generated",
        "test",
        "tests",
        "__tests__",
        "fixtures",
      ].includes(segment),
    ) ||
    relativePath.startsWith("apps/server/integration/") ||
    relativePath === "apps/server/scripts/acp-mock-agent.ts" ||
    relativePath === "apps/web/public/mockServiceWorker.js" ||
    /\.(?:test|spec|browser)\.[cm]?[jt]sx?$/.test(fileName) ||
    /\.(?:generated|gen)\.[cm]?[jt]sx?$/.test(fileName)
  );
}

function collectSourceFiles(directory: string, output: string[]): void {
  if (!Fs.existsSync(directory)) return;
  for (const entry of Fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = Path.join(directory, entry.name);
    const relativePath = repositoryPath(absolutePath);
    if (isIgnoredSource(relativePath)) continue;
    if (entry.isDirectory()) {
      collectSourceFiles(absolutePath, output);
      continue;
    }
    if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
      output.push(absolutePath);
    }
  }
}

function countLines(source: string): number {
  if (source.length === 0) return 0;
  const lines = source.split(/\r\n|\r|\n/);
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

function moduleSpecifiers(sourceFile: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const argument = node.arguments[0];
      if (
        argument &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        ts.isStringLiteral(argument)
      ) {
        specifiers.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function resolveSourceCandidate(base: string, sourceFiles: ReadonlySet<string>): string | null {
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
  const candidates = new Set<string>([
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => Path.join(base, `index${extension}`)),
  ]);
  if (/\.[cm]?js$/.test(base)) {
    candidates.add(base.replace(/\.[cm]?js$/, ".ts"));
    candidates.add(base.replace(/\.[cm]?js$/, ".tsx"));
    candidates.add(base.replace(/\.[cm]?js$/, ".mts"));
    candidates.add(base.replace(/\.[cm]?js$/, ".cts"));
  }
  for (const candidate of candidates) {
    const normalized = Path.normalize(candidate);
    if (sourceFiles.has(normalized)) return normalized;
  }
  return null;
}

function resolveInternalModule(
  importer: string,
  specifier: string,
  sourceFiles: ReadonlySet<string>,
): string | null {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0] ?? specifier;
  if (cleanSpecifier.startsWith(".")) {
    return resolveSourceCandidate(
      Path.resolve(Path.dirname(importer), cleanSpecifier),
      sourceFiles,
    );
  }
  if (cleanSpecifier.startsWith("~/")) {
    const webRoot = Path.join(REPOSITORY_ROOT, "apps/web/src");
    if (!Path.normalize(importer).startsWith(`${Path.normalize(webRoot)}${Path.sep}`)) return null;
    return resolveSourceCandidate(Path.join(webRoot, cleanSpecifier.slice(2)), sourceFiles);
  }
  return null;
}

function buildImportGraph(files: readonly string[]): Map<string, Set<string>> {
  const fileSet = new Set(files.map(Path.normalize));
  const graph = new Map<string, Set<string>>();
  for (const file of fileSet) {
    const source = Fs.readFileSync(file, "utf8");
    const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
    const dependencies = new Set<string>();
    for (const specifier of moduleSpecifiers(sourceFile)) {
      const resolved = resolveInternalModule(file, specifier, fileSet);
      if (resolved) dependencies.add(resolved);
    }
    graph.set(file, dependencies);
  }
  return graph;
}

function cyclicComponents(graph: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    const nodeIndex = nextIndex++;
    indices.set(node, nodeIndex);
    lowLinks.set(node, nodeIndex);
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(dependency)!));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(dependency)!));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let current: string;
    do {
      current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) {
      cycles.push(component.toSorted());
    }
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return cycles;
}

const sourceFiles: string[] = [];
for (const root of SOURCE_ROOTS) {
  collectSourceFiles(Path.join(REPOSITORY_ROOT, root), sourceFiles);
}
sourceFiles.sort();

const lineViolations: string[] = [];
const frozenGrowth: string[] = [];
let largestActive = { path: "", lines: 0 };
for (const file of sourceFiles) {
  const relativePath = repositoryPath(file);
  const lines = countLines(Fs.readFileSync(file, "utf8"));
  const frozen = FROZEN_OVERSIZED_FILES.get(relativePath);
  if (frozen) {
    if (lines > frozen.maxLines) {
      frozenGrowth.push(`${relativePath}: ${lines} > frozen ceiling ${frozen.maxLines}`);
    }
    continue;
  }
  if (lines > largestActive.lines) largestActive = { path: relativePath, lines };
  if (lines > MAX_PRODUCTION_LINES) {
    lineViolations.push(`${relativePath}: ${lines} lines`);
  }
}

const cycles = cyclicComponents(buildImportGraph(sourceFiles));
if (lineViolations.length > 0 || frozenGrowth.length > 0 || cycles.length > 0) {
  if (lineViolations.length > 0) {
    console.error("Production files above 500 lines:\n" + lineViolations.join("\n"));
  }
  if (frozenGrowth.length > 0) {
    console.error("Frozen oversized files grew:\n" + frozenGrowth.join("\n"));
  }
  if (cycles.length > 0) {
    console.error(
      "Source-local import cycle components:\n" +
        cycles.map((component) => component.map(repositoryPath).join(", ")).join("\n"),
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Architecture boundaries OK: ${sourceFiles.length} production source files; ` +
      `largest active file ${largestActive.path} (${largestActive.lines}); ` +
      `${FROZEN_OVERSIZED_FILES.size} frozen ceilings; 0 source-local import cycles.`,
  );
}
