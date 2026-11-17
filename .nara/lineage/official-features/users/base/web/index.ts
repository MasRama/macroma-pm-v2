export { createUsersClient, type UsersClient, type UsersClientOptions } from './client';
export {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_FILE_SIZE_BYTES,
  AVATAR_MAX_FILE_SIZE_MB,
  STALE_REVISION,
  USERS_CHANGED_EVENT,
  usersAccess,
  type UpdateProfileResponse,
  type UserProfile,
  type UsersAccess,
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
