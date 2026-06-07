/**
 * output — S10: human/JSON output helpers for nf-admin CLI.
 *
 * JSON success shape:  { ok: true, operation, result }
 * JSON failure shape:  { ok: false, operation, error: { code, message, details } }
 *
 * Security: never output raw secrets, hashes, provider secrets, DB URLs.
 * One-time secrets (rawCredential, rawSigningSecret) are printed only when
 * explicitly passed from create/rotate commands.
 */

export interface CliResult {
  ok: true;
  operation: string;
  result: Record<string, unknown>;
}

export interface CliError {
  ok: false;
  operation: string;
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}

export type CliOutput = CliResult | CliError;

export function succeed(operation: string, result: Record<string, unknown>): CliResult {
  return { ok: true, operation, result };
}

export function fail(
  operation: string,
  code: string,
  message: string,
  details: unknown = null,
): CliError {
  return { ok: false, operation, error: { code, message, details } };
}

export function printOutput(output: CliOutput, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return;
  }
  if (output.ok) {
    console.log(`✓ [${output.operation}] OK`);
    printHuman(output.result, 0);
  } else {
    console.error(`✗ [${output.operation}] FAILED — ${output.error.code}`);
    console.error(`  ${output.error.message}`);
    if (output.error.details) {
      console.error('  Details:', output.error.details);
    }
  }
}

function printHuman(obj: Record<string, unknown>, indent: number): void {
  const pad = '  '.repeat(indent);
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      console.log(`${pad}${k}: —`);
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      console.log(`${pad}${k}:`);
      printHuman(v as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        console.log(`${pad}${k}: []`);
      } else if (typeof v[0] === 'string') {
        console.log(`${pad}${k}: ${v.join(', ')}`);
      } else {
        console.log(`${pad}${k}: [${v.length} items]`);
        v.forEach((item, i) => {
          if (typeof item === 'object' && item !== null) {
            console.log(`${pad}  [${i}]:`);
            printHuman(item as Record<string, unknown>, indent + 2);
          } else {
            console.log(`${pad}  [${i}]: ${item}`);
          }
        });
      }
    } else {
      console.log(`${pad}${k}: ${v}`);
    }
  }
}

/** dryRunNote — print a dry-run preview notice. */
export function dryRunNote(operation: string, description: string, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(
      JSON.stringify({ ok: true, operation, dryRun: true, preview: description }, null, 2) + '\n',
    );
  } else {
    console.log(`[dry-run] ${operation}: ${description}`);
  }
}

/** oneTimeSecretNote — print a prominent notice about one-time secret handling. */
export function oneTimeSecretNote(jsonMode: boolean): void {
  if (!jsonMode) {
    console.log('');
    console.log('⚠  Save the above secret immediately — it will NOT be shown again.');
    console.log('');
  }
}
