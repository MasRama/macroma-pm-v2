import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import {
  createApiTokenInputSchema,
  type ApiTokenCreatedSuccess,
  type ApiTokenData,
  type ApiTokensSuccess,
  type RevokeApiTokensSuccess,
} from '../contract';
import { jsonInput } from '../../../shared/security';
import { Logger } from '../../../shared/logging';
import type { AuthActivitySink } from './activity';
import { apiTokenHash, generateApiTokenSecret } from './api-tokens';
import { API_TOKENS } from './config';
import { sessionGuard } from './guard';
import { confirmPassword } from './security-routes';
import { tokensChanged } from './live';
import {
  createApiToken,
  findUserById,
  listApiTokens,
  revokeAllApiTokens,
  revokeApiToken,
  type StoredApiToken,
} from './repository';

const DAY_MS = 24 * 60 * 60 * 1000;

function tokenPayload(token: StoredApiToken, now: number): ApiTokenData {
  return {
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scope: token.scope,
    createdAt: token.created_at,
    expiresAt: token.expires_at,
    lastUsedAt: token.last_used_at,
    expired: token.expires_at !== null && token.expires_at <= now,
  };
}

/**
 * Personal access tokens for the public API, managed from a signed-in browser
 * only: these routes read the session cookie, so a token can never mint or
 * revoke tokens. Creating one also re-confirms the password. The secret is in
 * the create answer once and never again.
 */
export function createTokenRoutes(activity?: AuthActivitySink) {
  return new Hono()
    .get('/tokens', sessionGuard.signedIn, (context) => {
      const { user } = sessionGuard.actor(context);
      const now = Date.now();
      return context.json({
        success: true as const,
        message: 'OK',
        data: { tokens: listApiTokens(user.id).map((token) => tokenPayload(token, now)) },
      } satisfies ApiTokensSuccess);
    })
    .post('/tokens', sessionGuard.signedIn, jsonInput(createApiTokenInputSchema), async (context) => {
      const { user } = sessionGuard.actor(context);
      const input = context.req.valid('json');
      // The same password confirmation as two-factor changes (400 INVALID_PASSWORD).
      const failure = await confirmPassword(context, findUserById(user.id)!, input.password);
      if (failure) return failure;
      const now = Date.now();
      const secret = generateApiTokenSecret();
      const stored: StoredApiToken = {
        id: randomUUID(),
        name: input.name,
        prefix: secret.slice(0, API_TOKENS.DISPLAY_LENGTH),
        scope: input.scope,
        expires_at: input.expiresInDays === null ? null : now + input.expiresInDays * DAY_MS,
        last_used_at: null,
        created_at: now,
      };
      const created = createApiToken(
        {
          id: stored.id,
          userId: user.id,
          name: stored.name,
          tokenHash: apiTokenHash(secret),
          prefix: stored.prefix,
          scope: stored.scope,
          expiresAt: stored.expires_at,
        },
        API_TOKENS.MAX_ACTIVE_PER_USER,
        now,
      );
      if (!created) {
        return context.json(
          {
            success: false as const,
            message: `An account can hold at most ${API_TOKENS.MAX_ACTIVE_PER_USER} working API tokens. Revoke one first.`,
            code: 'TOKEN_LIMIT_REACHED' as const,
          },
          409,
        );
      }
      tokensChanged(user.id);
      Logger.logAuth('api_token_created', { userId: user.id, tokenId: stored.id, scope: stored.scope });
      activity?.({
        action: 'auth.token-created',
        resource: 'auth',
        actorId: user.id,
        targetId: user.id,
        targetLabel: user.name,
        metadata: { name: stored.name, scope: stored.scope },
      });
      return context.json(
        {
          success: true as const,
          message: 'API token created. Copy it now: it is not shown again.',
          data: { token: tokenPayload(stored, now), secret },
        } satisfies ApiTokenCreatedSuccess,
        201,
      );
    })
    .post('/tokens/revoke-all', sessionGuard.signedIn, (context) => {
      const { user } = sessionGuard.actor(context);
      const revoked = revokeAllApiTokens(user.id);
      if (revoked > 0) {
        tokensChanged(user.id);
        Logger.logAuth('api_tokens_revoked', { userId: user.id, revoked });
        activity?.({
          action: 'auth.tokens-revoked',
          resource: 'auth',
          actorId: user.id,
          targetId: user.id,
          targetLabel: user.name,
          metadata: { revoked },
        });
      }
      return context.json({
        success: true as const,
        message: 'API tokens revoked',
        data: { revoked },
      } satisfies RevokeApiTokensSuccess);
    })
    .delete('/tokens/:id', sessionGuard.signedIn, (context) => {
      const { user } = sessionGuard.actor(context);
      const token = revokeApiToken(user.id, context.req.param('id'));
      if (!token) {
        return context.json({ success: false as const, message: 'API token not found', code: 'NOT_FOUND' as const }, 404);
      }
      tokensChanged(user.id);
      Logger.logAuth('api_token_revoked', { userId: user.id, tokenId: token.id });
      activity?.({
        action: 'auth.token-revoked',
        resource: 'auth',
        actorId: user.id,
        targetId: user.id,
        targetLabel: user.name,
        metadata: { name: token.name, scope: token.scope },
      });
      return context.json({
        success: true as const,
        message: 'API token revoked',
        data: { revoked: 1 },
      } satisfies RevokeApiTokensSuccess);
    });
}
