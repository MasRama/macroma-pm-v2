import { hc } from 'hono/client';
import type {
  AuthError,
  AuthSuccess,
  ChangePasswordInput,
  ChangePasswordResponse,
  CurrentUserResponse,
  ForgotPasswordInput,
  ForgotPasswordResponse,
  LoginInput,
  LoginResponse,
  RegisterInput,
  RegisterResponse,
  ResetPasswordInput,
  ResetPasswordResponse,
} from '../contract';
import type { authRoutes } from '..';
import { apiFetch } from './csrf';

export interface AuthClient {
  register(input: RegisterInput): Promise<RegisterResponse>;
  login(input: LoginInput): Promise<LoginResponse>;
  changePassword(input: ChangePasswordInput): Promise<ChangePasswordResponse>;
  me(): Promise<CurrentUserResponse>;
  logout(): Promise<AuthSuccess | AuthError>;
  /** Always succeeds for a well-formed email, whether or not it has an account. */
  forgotPassword(input: ForgotPasswordInput): Promise<ForgotPasswordResponse>;
  resetPassword(input: ResetPasswordInput): Promise<ResetPasswordResponse>;
}

export function createAuthClient(baseUrl = '/api/auth'): AuthClient {
  const api = hc<typeof authRoutes>(baseUrl.replace(/\/$/, ''), { fetch: apiFetch });

  return {
    register: async (input) => (await api.register.$post({ json: input })).json(),
    login: async (input) => (await api.login.$post({ json: input })).json(),
    changePassword: async (input) => (await api['change-password'].$post({ json: input })).json(),
    me: async () => (await api.me.$get()).json(),
    logout: async () => (await api.logout.$post()).json(),
    forgotPassword: async (input) => (await api['forgot-password'].$post({ json: input })).json(),
    resetPassword: async (input) => (await api['reset-password'].$post({ json: input })).json(),
  };
}
