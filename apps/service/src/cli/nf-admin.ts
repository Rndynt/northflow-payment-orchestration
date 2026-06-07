#!/usr/bin/env tsx
/**
 * nf-admin — S10: Northflow Admin CLI.
 *
 * Provides operator commands to bootstrap and manage the payment orchestration
 * service without requiring a running HTTP server or dashboard.
 *
 * Usage:
 *   pnpm --filter @northflow/payment-orchestration-service nf:admin <command> [flags]
 *
 * Commands:
 *   create-client          Create a new API client
 *   list-clients           List all API clients
 *   get-client             Get a single API client with credentials and signing keys
 *   create-credential      Create a bearer credential for an API client
 *   revoke-credential      Revoke a bearer credential
 *   create-signing-key     Create an HMAC signing key for an API client
 *   revoke-signing-key     Revoke an HMAC signing key
 *   create-merchant        Create a merchant
 *   grant-merchant         Grant an API client access to a merchant
 *   revoke-merchant        Revoke an API client's access to a merchant
 *   create-provider-account Create a provider account for a merchant
 *   list-payment-methods   List payment methods for a provider account
 *   enable-payment-method  Enable/upsert a payment method on a provider account
 *   disable-payment-method Disable a payment method on a provider account
 *   bootstrap-bundle       Full bootstrap: client + credential + merchant + grant
 *
 * Global flags:
 *   --json         Output machine-readable JSON (success and error)
 *   --dry-run      Validate inputs and preview — write nothing to database
 *   --yes          Confirm irreversible operations without interactive prompt
 *   --help, -h     Show this help message
 *
 * Exit codes:
 *   0   Success
 *   1   Failure (invalid args, not found, operation failed, etc.)
 *   2   Misconfiguration (missing required env vars)
 *
 * Environment:
 *   PAYMENT_ORCHESTRATION_DATABASE_URL or DATABASE_URL           (required)
 *   PAYMENT_ORCHESTRATION_ADMIN_BOOTSTRAP_TOKEN                  (optional, hardens access)
 *   PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_SECRET          (required for signing key ops)
 *   PAYMENT_ORCHESTRATION_SIGNING_KEY_ENCRYPTION_KEY_VERSION     (optional, default: v1)
 */

import { parseArgs } from './parseArgs.ts';
import { printOutput, fail } from './output.ts';
import type { CliOutput } from './output.ts';
import { createAdminContext, assertAdminToken } from './adminContext.ts';

import { runCreateClient } from './commands/createClient.ts';
import { runListClients } from './commands/listClients.ts';
import { runGetClient } from './commands/getClient.ts';
import { runCreateCredential } from './commands/createCredential.ts';
import { runRevokeCredential } from './commands/revokeCredential.ts';
import { runCreateSigningKey } from './commands/createSigningKey.ts';
import { runRevokeSigningKey } from './commands/revokeSigningKey.ts';
import { runCreateMerchant } from './commands/createMerchant.ts';
import { runGrantMerchant } from './commands/grantMerchant.ts';
import { runRevokeMerchant } from './commands/revokeMerchant.ts';
import { runCreateProviderAccount } from './commands/createProviderAccount.ts';
import { runListPaymentMethods } from './commands/listPaymentMethods.ts';
import { runEnablePaymentMethod } from './commands/enablePaymentMethod.ts';
import { runDisablePaymentMethod } from './commands/disablePaymentMethod.ts';
import { runBootstrapBundle } from './commands/bootstrapBundle.ts';

const HELP_TEXT = `
nf-admin — Northflow Payment Orchestration Admin CLI

Usage:
  nf-admin <command> [flags]

Commands:
  create-client            Create a new API client
  list-clients             List all API clients (read-only)
  get-client               Get a single API client with credentials and signing keys (read-only)
  create-credential        Create a bearer credential for an API client
  revoke-credential        Revoke a bearer credential
  create-signing-key       Create an HMAC signing key for an API client
  revoke-signing-key       Revoke an HMAC signing key
  create-merchant          Create a merchant
  grant-merchant           Grant an API client access to a merchant
  revoke-merchant          Revoke an API client's access to a merchant
  create-provider-account  Create a provider account for a merchant
  list-payment-methods     List payment methods for a provider account (read-only)
  enable-payment-method    Enable/upsert a payment method on a provider account
  disable-payment-method   Disable a payment method on a provider account
  bootstrap-bundle         Full bootstrap: client + credential + merchant + grant

Global flags:
  --json        Output machine-readable JSON
  --dry-run     Preview only — write nothing to the database
  --yes         Confirm irreversible operations
  --help, -h    Show this help message

Examples:
  # Create an API client
  nf-admin create-client --name "My Service" --source-app my-service --environment sandbox

  # Create a credential for the client
  nf-admin create-credential --client-id <clientId>

  # Create a signing key (requires encryption secret configured)
  nf-admin create-signing-key --client-id <clientId>

  # Full bootstrap in one command
  nf-admin bootstrap-bundle --name "My Service" --source-app my-service \\
    --environment sandbox --merchant-name "My Merchant" --yes

  # Machine-readable output
  nf-admin create-merchant --name "Acme" --json

  # Dry-run any command
  nf-admin create-client --name "Test" --source-app test --environment sandbox --dry-run
`.trim();

/** READ_ONLY_COMMANDS — do not require the admin token check. */
const READ_ONLY_COMMANDS = new Set([
  'list-clients',
  'get-client',
  'list-payment-methods',
]);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || args.command === null) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const { command } = args;

  if (!READ_ONLY_COMMANDS.has(command)) {
    assertAdminToken();
  }

  let ctx: ReturnType<typeof createAdminContext> | null = null;
  let output: CliOutput;

  try {
    ctx = createAdminContext();

    switch (command) {
      case 'create-client':
        output = await runCreateClient(args, ctx);
        break;
      case 'list-clients':
        output = await runListClients(args, ctx);
        break;
      case 'get-client':
        output = await runGetClient(args, ctx);
        break;
      case 'create-credential':
        output = await runCreateCredential(args, ctx);
        break;
      case 'revoke-credential':
        output = await runRevokeCredential(args, ctx);
        break;
      case 'create-signing-key':
        output = await runCreateSigningKey(args, ctx);
        break;
      case 'revoke-signing-key':
        output = await runRevokeSigningKey(args, ctx);
        break;
      case 'create-merchant':
        output = await runCreateMerchant(args, ctx);
        break;
      case 'grant-merchant':
        output = await runGrantMerchant(args, ctx);
        break;
      case 'revoke-merchant':
        output = await runRevokeMerchant(args, ctx);
        break;
      case 'create-provider-account':
        output = await runCreateProviderAccount(args, ctx);
        break;
      case 'list-payment-methods':
        output = await runListPaymentMethods(args, ctx);
        break;
      case 'enable-payment-method':
        output = await runEnablePaymentMethod(args, ctx);
        break;
      case 'disable-payment-method':
        output = await runDisablePaymentMethod(args, ctx);
        break;
      case 'bootstrap-bundle':
        output = await runBootstrapBundle(args, ctx);
        break;
      default:
        output = fail(
          command,
          'ADMIN_INVALID_ARGUMENT',
          `Unknown command: ${command}. Run nf-admin --help for usage.`,
        );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    output = fail(
      args.command ?? 'unknown',
      'ADMIN_OPERATION_FAILED',
      msg,
    );
  } finally {
    if (ctx) {
      try {
        await (ctx.db as any)?.end?.();
      } catch {
        // Ignore DB close errors
      }
    }
  }

  printOutput(output, args.json);
  process.exit(output.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[nf-admin] Unexpected error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
