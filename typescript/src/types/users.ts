/** Request to create or promote a user profile. */
export interface CreateProfileRequest {
  /** Display name for a new profile. */
  display_name?: string;
  /** Canonical ID to promote an existing entity. */
  canonical_id?: string;
}

/** User profile response. */
export interface UserProfile {
  canonical_id: string;
  display_name: string;
  is_user_root: boolean;
  semantic_tags?: string[];
}
