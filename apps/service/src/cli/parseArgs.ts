/**
 * parseArgs — S10: minimal CLI argument parser for nf-admin.
 *
 * Parses process.argv-style string arrays into flags and positionals.
 * No external dependencies.
 *
 * Supports:
 *   --flag          boolean true
 *   --flag value    string value
 *   --flag=value    string value
 *   positional      non-flag strings (command name, etc.)
 */

export interface ParsedArgs {
  command: string | null;
  flags: Record<string, string | boolean>;
  positionals: string[];
  /** Global shortcut accessors */
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const val = arg.slice(eqIdx + 1);
        flags[key] = val;
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positionals.push(arg);
    }
    i++;
  }

  const command = positionals[0] ?? null;

  return {
    command,
    flags,
    positionals,
    json: flags['json'] === true,
    dryRun: flags['dry-run'] === true,
    yes: flags['yes'] === true,
    help: flags['help'] === true || flags['h'] === true,
  };
}

/** getFlag — get a string flag value or null. */
export function getFlag(args: ParsedArgs, name: string): string | null {
  const v = args.flags[name];
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/** requireFlag — get a string flag value or throw ADMIN_INVALID_ARGUMENT. */
export function requireFlag(args: ParsedArgs, name: string): string {
  const v = getFlag(args, name);
  if (!v) {
    const err = new Error(`--${name} is required`);
    (err as any).code = 'ADMIN_INVALID_ARGUMENT';
    throw err;
  }
  return v;
}

/** parseScopes — split comma-separated scopes string into an array. */
export function parseScopes(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** parseJsonFlag — parse --metadata JSON string into object or throw. */
export function parseJsonFlag(args: ParsedArgs, name: string): Record<string, unknown> | null {
  const v = getFlag(args, name);
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`--${name} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  } catch {
    const err = new Error(`--${name} must be valid JSON object`);
    (err as any).code = 'ADMIN_INVALID_ARGUMENT';
    throw err;
  }
}
