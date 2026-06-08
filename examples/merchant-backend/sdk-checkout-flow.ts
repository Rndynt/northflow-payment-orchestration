import {
  PaymentOrchestrationClient,
  PaymentOrchestrationClientError,
} from '@northflow/payment-orchestration-client-sdk';

interface LocalOrder {
  id: string;
  totalAmount: number;
  currency: string;
}

const northflow = new PaymentOrchestrationClient({
  baseUrl: process.env['NORTHFLOW_BASE_URL']!,
  apiKey: process.env['NORTHFLOW_API_KEY']!,
  merchantId: process.env['NORTHFLOW_MERCHANT_ID']!,
  sourceApp: process.env['NORTHFLOW_SOURCE_APP'] ?? 'checkout-backend',
  signing: process.env['NORTHFLOW_SIGNING_SECRET']
    ? {
        enabled: true,
        clientId: process.env['NORTHFLOW_CLIENT_ID']!,
        keyId: process.env['NORTHFLOW_SIGNING_KEY_ID']!,
        secret: process.env['NORTHFLOW_SIGNING_SECRET']!,
      }
    : undefined,
});

export async function createCheckoutPayment(order: LocalOrder, selectedMethod = 'qris') {
  try {
    const intent = await northflow.createPaymentIntent({
      sourceApp: process.env['NORTHFLOW_SOURCE_APP'] ?? 'checkout-backend',
      externalPayableType: 'order',
      externalPayableId: order.id,
      currency: order.currency,
      amountDue: order.totalAmount,
      idempotencyKey: `order:${order.id}:intent`,
    });

    const options = await northflow.getPaymentOptions(intent.id);
    const selected = options.options.find((option) => option.method === selectedMethod);
    if (!selected) throw new Error(`Payment method is not available: ${selectedMethod}`);

    const payment = await northflow.createGatewayPayment(intent.id, {
      provider: selected.provider,
      providerAccountId: selected.providerAccountId,
      method: selected.method,
      amount: order.totalAmount,
      idempotencyKey: `order:${order.id}:payment:${selected.method}`,
    });

    return {
      intentId: intent.id,
      transactionId: payment.transaction.id,
      status: payment.intent.status,
      paymentUrl: payment.transaction.providerPaymentUrl,
      qrString: payment.transaction.providerQrString,
    };
  } catch (err) {
    if (err instanceof PaymentOrchestrationClientError) {
      throw new Error(`Northflow request failed: ${err.status} ${err.code ?? 'UNKNOWN'}`);
    }
    throw err;
  }
}
