import { hc } from 'hono/client';
import type {
  ApiTokensResponse,
  AuthError,
  AuthSuccess,
  ConfirmPasswordInput,
  CreateApiTokenInput,
  CreateApiTokenResponse,
  RecoveryCodesResponse,
  RevokeApiTokensResponse,
  RevokeSessionsResponse,
  SessionsResponse,
  TwoFactorChallengeInput,
  TwoFactorChallengeResponse,
  TwoFactorCodeInput,
  TwoFactorSetupResponse,
  TwoFactorStatusResponse,
} from '../contract';
import type { authRoutes } from '..';
import { apiFetch } from './csrf';

export interface SecurityClient {
  completeTwoFactor(input: TwoFactorChallengeInput): Promise<TwoFactorChallengeResponse>;
  listSessions(): Promise<SessionsResponse>;
  revokeSession(id: string): Promise<RevokeSessionsResponse>;
  revokeOtherSessions(): Promise<RevokeSessionsResponse>;
  twoFactorStatus(): Promise<TwoFactorStatusResponse>;
  startTwoFactorSetup(input: ConfirmPasswordInput): Promise<TwoFactorSetupResponse>;
  enableTwoFactor(input: TwoFactorCodeInput): Promise<RecoveryCodesResponse>;
  disableTwoFactor(input: ConfirmPasswordInput): Promise<AuthSuccess | AuthError>;
  regenerateRecoveryCodes(input: ConfirmPasswordInput): Promise<RecoveryCodesResponse>;
  /** The account's API tokens that are not revoked, expired ones included, newest first. */
  listTokens(): Promise<ApiTokensResponse>;
  /** Creates a token; `data.secret` is the only time its secret is ever shown. */
  createToken(input: CreateApiTokenInput): Promise<CreateApiTokenResponse>;
  revokeToken(id: string): Promise<RevokeApiTokensResponse>;
  revokeAllTokens(): Promise<RevokeApiTokensResponse>;
}

export function createSecurityClient(baseUrl = '/api/auth'): SecurityClient {
  const api = hc<typeof authRoutes>(baseUrl.replace(/\/$/, ''), { fetch: apiFetch });
  const twoFactor = api['two-factor'];

  return {
    completeTwoFactor: async (input) => (await twoFactor.challenge.$post({ json: input })).json(),
    listSessions: async () => (await api.sessions.$get()).json(),
    revokeSession: async (id) => (await api.sessions[':id'].$delete({ param: { id } })).json(),
    revokeOtherSessions: async () => (await api.sessions['revoke-others'].$post()).json(),
    twoFactorStatus: async () => (await twoFactor.$get()).json(),
    startTwoFactorSetup: async (input) => (await twoFactor.setup.$post({ json: input })).json(),
    enableTwoFactor: async (input) => (await twoFactor.enable.$post({ json: input })).json(),
    disableTwoFactor: async (input) => (await twoFactor.disable.$post({ json: input })).json(),
    regenerateRecoveryCodes: async (input) => (await twoFactor['recovery-codes'].$post({ json: input })).json(),
    listTokens: async () => (await api.tokens.$get()).json(),
    createToken: async (input) => (await api.tokens.$post({ json: input })).json(),
    revokeToken: async (id) => (await api.tokens[':id'].$delete({ param: { id } })).json(),
    revokeAllTokens: async () => (await api.tokens['revoke-all'].$post()).json(),
  };
}
