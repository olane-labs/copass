import type { CreateProfileRequest, UserProfile } from '../types/users.js';

/**
 * Users resource — user profile management.
 *
 * Endpoint: POST /users/me/profile
 */
export interface UsersResource {
  /** Create or promote a user profile. */
  createProfile(request: CreateProfileRequest): Promise<UserProfile>;
}
