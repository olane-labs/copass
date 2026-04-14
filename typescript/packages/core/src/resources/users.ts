import { BaseResource } from './base.js';
import type { CreateProfileRequest, UserProfile } from '../types/users.js';

/**
 * Users resource — user profile management.
 */
export class UsersResource extends BaseResource {
  async createProfile(request: CreateProfileRequest): Promise<UserProfile> {
    return this.post<UserProfile>('/api/v1/users/me/profile', request);
  }
}
