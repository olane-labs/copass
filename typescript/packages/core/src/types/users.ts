/** Request to create or promote a user profile. */
export interface CreateProfileRequest {
  /** Display name for a new profile. */
  display_name?: string;
  /** Canonical ID to promote an existing entity. */
  canonical_id?: string;
  /** Additional semantic tags (``"person"`` is auto-added). */
  semantic_tags?: string[];
  /** Arbitrary metadata to persist on the canonical. */
  metadata?: Record<string, unknown>;
}

/** User profile response — mirrors backend ``UserProfileResponse``. */
export interface UserProfile {
  user_id: string;
  canonical_id: string;
  display_name: string;
  is_user_root: boolean;
  semantic_tags?: string[];
  /** ``true`` for a fresh creation, ``false`` for promote / fetch. */
  was_created?: boolean;
  created_at?: string;
  metadata?: Record<string, unknown>;
  /** Auto-provisioned primary sandbox. */
  sandbox_id?: string;
  /** Auto-provisioned default project inside ``sandbox_id``. */
  project_id?: string;
}
