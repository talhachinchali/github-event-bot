/**
 * Fills {{placeholders}} in comment templates. Only a fixed set of variables exists and values are inserted
 * as plain text: no expressions, no eval, so a rule author cannot execute anything.
 */
export function renderTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  // hasOwn: names like "constructor" or "__proto__" must not resolve through the prototype chain.
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name] ?? "") : "",
  );
}
