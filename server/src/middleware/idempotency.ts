import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../db/prisma.js';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireIdempotency(req: Request, res: Response, next: NextFunction): void {
  const keyHeader = req.header('idempotency-key');

  if (!keyHeader || !UUID_V4_REGEX.test(keyHeader)) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Idempotency-Key header (UUID v4) is required',
        details: { header: 'Idempotency-Key' },
      },
    });
    return;
  }

  const key = keyHeader.toLowerCase();
  const userId = req.user?.id || '00000000-0000-0000-0000-000000000000';
  const route = req.originalUrl || req.path;

  // Compute SHA-256 of the request body
  const bodyString = JSON.stringify(req.body || {});
  const requestHash = crypto.createHash('sha256').update(bodyString).digest('hex');

  (async () => {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 30 * 1000); // 30 seconds lock

    // 1. INSERT ... ON CONFLICT DO NOTHING
    try {
      await prisma.$executeRaw`
        INSERT INTO idempotency_keys (key, user_id, route, request_hash, locked_until, created_at)
        VALUES (${key}::uuid, ${userId}::uuid, ${route}, ${requestHash}, ${lockedUntil}, ${now})
        ON CONFLICT (key) DO NOTHING
      `;
    } catch {
      // Continue to query
    }

    // 2. Query the existing key
    const record = await prisma.idempotencyKey.findUnique({
      where: { key },
    });

    if (!record) {
      next();
      return;
    }

    // (4) If stored request_hash differs -> 422 IDEMPOTENCY_KEY_REUSED
    if (record.requestHash !== requestHash) {
      res.status(422).json({
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'An idempotency key cannot be reused with a different request payload',
          details: { key },
        },
      });
      return;
    }

    // (2) If row exists with stored response -> replay
    if (record.responseBody !== null && record.statusCode !== null) {
      res.setHeader('Idempotent-Replay', 'true');
      res.status(record.statusCode).json(record.responseBody);
      return;
    }

    // (3) If locked and has no response -> 409 REQUEST_IN_PROGRESS
    if (record.lockedUntil && record.lockedUntil > new Date() && record.responseBody === null) {
      // Check if this was just inserted by current request
      const isJustCreated = Math.abs(record.createdAt.getTime() - now.getTime()) < 1000;
      if (!isJustCreated) {
        res.status(409).json({
          error: {
            code: 'REQUEST_IN_PROGRESS',
            message: 'A request with this idempotency key is currently in progress',
            details: { key },
          },
        });
        return;
      }
    }

    // (5) Run handler and store status and response
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let capturedBody: unknown = null;

    res.json = (body: unknown) => {
      capturedBody = body;
      return originalJson(body);
    };

    res.send = (body: unknown) => {
      if (!capturedBody && typeof body === 'string') {
        try {
          capturedBody = JSON.parse(body);
        } catch {
          capturedBody = body;
        }
      }
      return originalSend(body);
    };

    res.on('finish', () => {
      if (capturedBody !== null && res.statusCode >= 200 && res.statusCode < 300) {
        prisma.idempotencyKey
          .update({
            where: { key },
            data: {
              statusCode: res.statusCode,
              responseBody: capturedBody as any,
              lockedUntil: null,
            },
          })
          .catch(() => {});
      } else if (res.statusCode >= 400) {
        // If request failed, remove lock or delete row so it can be safely retried
        prisma.idempotencyKey
          .delete({
            where: { key },
          })
          .catch(() => {});
      }
    });

    next();
  })().catch(next);
}
