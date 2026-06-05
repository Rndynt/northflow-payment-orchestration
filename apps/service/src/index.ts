/**
 * index — entry point for payment-orchestration-service.
 *
 * Phase 8A: skeletal service. Listens on PAYMENT_ORCHESTRATION_SERVICE_PORT (default 5100).
 * Does NOT share a port with apps/api (port 5000).
 *
 * Start command:
 *   npx tsx --tsconfig tsconfig.json src/index.ts
 *
 * Or via package script:
 *   pnpm --filter @northflow/payment-orchestration-service dev
 */

import { loadEnv } from './config/env.ts';
import { createContainer } from './container.ts';
import { createApp } from './app.ts';

const config = loadEnv();
const container = createContainer(config);
const app = createApp(container);

app.listen(config.port, () => {
  const base = `http://localhost:${config.port}`;
  console.log(
    `[payment-orchestration-service] Phase ${config.phase} listening on port ${config.port} ` +
      `(NODE_ENV=${config.nodeEnv})`,
  );
  console.log(`  GET  ${base}/health`);
  console.log(`  GET  ${base}/version`);
  console.log('');
  console.log('  API v1 routes (service token required):');
  console.log(`  POST ${base}/v1/merchants`);
  console.log(`  GET  ${base}/v1/merchants/:id`);
  console.log(`  POST ${base}/v1/merchants/:merchantId/provider-accounts`);
  console.log(`  GET  ${base}/v1/merchants/:merchantId/provider-accounts/:id`);
  console.log(`  POST ${base}/v1/payment-intents`);
  console.log(`  GET  ${base}/v1/payment-intents/:id/status`);
  console.log(`  GET  ${base}/v1/payment-intents/:id/refundability`);
  console.log(`  POST ${base}/v1/payment-intents/:id/gateway-payments`);
  if (config.nodeEnv !== 'production') {
    console.log('');
    console.log('  Dev/test only:');
    console.log(`  POST ${base}/v1/dev/fake-gateway/transactions/:transactionId/confirm`);
  }
});
