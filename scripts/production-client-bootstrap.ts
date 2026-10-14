/** Audit actual built JavaScript, not source spelling or dynamic preload lists. */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

type Module = { path: string; sha256: string; staticImports: string[]; interfaceExport: boolean };
export type BootstrapAudit = { dist: string; modules: Module[]; interfaceModule: string | null; reachable: string[];
  forbiddenPaths: string[][]; errors: string[]; passed: boolean };

function namesVisuals(node: ts.Node): boolean {
  if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node))
    && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === 'initializeVisuals') return true;
  return ts.forEachChild(node, namesVisuals) ?? false;
}
function inspect(path: string): Module {
  const text = readFileSync(path, 'utf8');
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) throw new Error(`Cannot parse built module ${path}: ${ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, '\n')}`);
  const initializers = new Map<string, ts.Expression>();
  for (const statement of ast.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer)
      initializers.set(declaration.name.text, declaration.initializer);
  }
  // Rollup exports a minified frozen namespace variable whose object retains this public API name.
  const exportedVisuals = (name: string): boolean => name === 'initializeVisuals'
    || !!(initializers.get(name) && namesVisuals(initializers.get(name)!));
  const staticImports: string[] = [];
  let interfaceExport = false;
  for (const statement of ast.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier) {
      if (!ts.isStringLiteral(statement.moduleSpecifier)) throw new Error(`Nonliteral static import in ${path}`);
      staticImports.push(statement.moduleSpecifier.text);
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause))
      interfaceExport ||= statement.exportClause.elements.some(e => e.name.text === 'initializeVisuals' || exportedVisuals((e.propertyName ?? e.name).text));
    if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'initializeVisuals') interfaceExport = true;
      if (ts.isVariableStatement(statement)) interfaceExport ||= statement.declarationList.declarations.some(d => ts.isIdentifier(d.name) && exportedVisuals(d.name.text));
    }
  }
  return { path, sha256: createHash('sha256').update(text).digest('hex'), staticImports, interfaceExport };
}
export function auditProductionClientBootstrap(directory: string): BootstrapAudit {
  const dist = resolve(directory);
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? files(join(dir, e.name)) : e.isFile() && /\.(?:m?js)$/.test(e.name) ? [join(dir, e.name)] : []);
  const modules = files(dist).sort().map(inspect);
  const byPath = new Map(modules.map(m => [m.path, m]));
  const interfaces = modules.filter(m => m.interfaceExport);
  const result: BootstrapAudit = { dist, modules, interfaceModule: null, reachable: [], forbiddenPaths: [], errors: [], passed: false };
  if (interfaces.length !== 1) {
    result.errors.push(`Expected exactly one built initializeVisuals interface module; found ${interfaces.length}`);
    return result;
  }
  const entry = interfaces[0]!; result.interfaceModule = relative(dist, entry.path);
  const pending: { module: Module; chain: string[] }[] = [{ module: entry, chain: [relative(dist, entry.path)] }];
  const seen = new Set<string>();
  while (pending.length) {
    const { module, chain } = pending.shift()!;
    if (seen.has(module.path)) continue;
    seen.add(module.path); result.reachable.push(relative(dist, module.path));
    if (/^world3d(?:[-.]|$)/.test(basename(module.path))) result.forbiddenPaths.push(chain);
    for (const specifier of module.staticImports) {
      if (!specifier.startsWith('.')) { result.errors.push(`Unresolved non-relative static import ${specifier} in ${relative(dist, module.path)}`); continue; }
      const dependency = byPath.get(resolve(dirname(module.path), specifier));
      if (!dependency) { result.errors.push(`Missing built static dependency ${specifier} in ${relative(dist, module.path)}`); continue; }
      pending.push({ module: dependency, chain: [...chain, relative(dist, dependency.path)] });
    }
  }
  if (result.forbiddenPaths.length) result.errors.push('Interface bootstrap statically reaches the world3d manual chunk before its dynamic boundary');
  result.passed = result.errors.length === 0;
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = auditProductionClientBootstrap(process.argv[2] ?? 'dist');
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ passed: false, error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
