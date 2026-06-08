import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { ServiceContainer } from '../container.ts';
import { requireScope } from '../middleware/requireScope.ts';
import { assertMerchantAccessWithScope } from '../middleware/merchantAccess.ts';
import { apiErrorResponse } from './utils.ts';

async function guard(req: Request, res: Response, container: ServiceContainer, merchantId: string, scope: string): Promise<boolean> {
  const denied = await assertMerchantAccessWithScope(req.auth!, merchantId, scope, container.authRepos?.clientMerchantAccessRepo);
  if (denied) { res.status(denied.status).json(denied.body); return false; }
  return true;
}

export function createMerchantWebhooksRouter(container: ServiceContainer): Router {
  const router = Router({ mergeParams: true });

  router.post('/endpoints', requireScope('webhook:manage'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const merchantId = String(req.params['merchantId']);
      if (!(await guard(req, res, container, merchantId, 'webhook:manage'))) return;
      const uc = container.useCases.createMerchantWebhookEndpoint;
      if (!uc) { res.status(501).json(apiErrorResponse('NOT_IMPLEMENTED', 'Merchant outbound webhooks are not wired.')); return; }
      const body = req.body as Record<string, unknown>;
      if (typeof body['url'] !== 'string') { res.status(400).json(apiErrorResponse('VALIDATION_ERROR', 'url is required.')); return; }
      const result = await uc.execute({ merchantId, url: body['url'], subscribedEvents: body['subscribedEvents'], metadata: body['metadata'] as any });
      res.status(201).json({ ok: true, data: result });
    } catch (err) { next(err); }
  });

  router.get('/endpoints', requireScope('webhook:read'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const merchantId = String(req.params['merchantId']);
      if (!(await guard(req, res, container, merchantId, 'webhook:read'))) return;
      const result = await container.useCases.listMerchantWebhookEndpoints!.execute({ merchantId });
      res.json({ ok: true, data: result });
    } catch (err) { next(err); }
  });

  router.post('/endpoints/:endpointId/disable', requireScope('webhook:manage'), async (req, res, next) => {
    try {
      const merchantId = String(req.params['merchantId']);
      if (!(await guard(req, res, container, merchantId, 'webhook:manage'))) return;
      const result = await container.useCases.disableMerchantWebhookEndpoint!.execute({ merchantId, endpointId: String(req.params['endpointId']) });
      res.json({ ok: true, data: result });
    } catch (err) { next(err); }
  });

  router.post('/endpoints/:endpointId/rotate-secret', requireScope('webhook:manage'), async (req, res, next) => {
    try {
      const merchantId = String(req.params['merchantId']);
      if (!(await guard(req, res, container, merchantId, 'webhook:manage'))) return;
      const result = await container.useCases.rotateMerchantWebhookEndpointSecret!.execute({ merchantId, endpointId: String(req.params['endpointId']) });
      res.json({ ok: true, data: result });
    } catch (err) { next(err); }
  });

  router.get('/deliveries', requireScope('webhook:read'), async (req, res, next) => {
    try {
      const merchantId = String(req.params['merchantId']);
      if (!(await guard(req, res, container, merchantId, 'webhook:read'))) return;
      const result = await container.useCases.listMerchantWebhookDeliveries!.execute({ merchantId, endpointId: typeof req.query['endpointId'] === 'string' ? req.query['endpointId'] : null, limit: req.query['limit'] ? Number(req.query['limit']) : undefined });
      res.json({ ok: true, data: result });
    } catch (err) { next(err); }
  });

  router.post('/replay', requireScope('webhook:manage'), async (req, res, next) => {
    try {
      const merchantId = String(req.params['merchantId']);
      if (!(await guard(req, res, container, merchantId, 'webhook:manage'))) return;
      const body = req.body as Record<string, unknown>;
      const result = await container.useCases.replayMerchantWebhook!.execute({ merchantId, deliveryId: typeof body['deliveryId'] === 'string' ? body['deliveryId'] : null, eventId: typeof body['eventId'] === 'string' ? body['eventId'] : null });
      res.json({ ok: true, data: result });
    } catch (err) { next(err); }
  });

  return router;
}
