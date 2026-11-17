export { createUsersClient, type UsersClient, type UsersClientOptions } from './client';
export {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_FILE_SIZE_BYTES,
  AVATAR_MAX_FILE_SIZE_MB,
  createUserInputSchema,
  STALE_REVISION,
  updateUserInputSchema,
  USERS_CHANGED_EVENT,
  USERS_EDITING_EVENT,
  USERS_FILTERS,
  usersAccess,
  type ManagedUser,
  type StaleUserError,
  type UpdateProfileResponse,
  type UpdateUserInput,
  type UpdateUserResponse,
  type UserProfile,
  type UsersAccess,
  type UsersEditor,
  type UsersFilter,
} from '../contract';
export type {
  UsersPasswordChange,
  UsersPasswordChangeResult,
  UsersWebCsrf,
  UsersWebHost,
  UsersWebRole,
  UsersWebSessionUser,
} from './host';
export { default as ProfilePage } from './pages/ProfilePage.vue';
export { default as UsersPage } from './pages/UsersPage.vue';
