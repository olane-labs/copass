/** Request to create a user profile.
 *
 * The platform auto-provisions a primary sandbox and default project on
 * first profile creation; those identifiers come back on the response
 * but are not part of the request.
 */
export interface CreateProfileRequest {
  /** Display name for a new profile. */
  display_name: string;
}

/** Public user profile shape.
 *
 * Internal ontology fields (``canonical_id``, ``is_user_root``,
 * ``was_created``, ``semantic_tags``, ``metadata``) are intentionally
 * not exposed. Consumers that need their auto-provisioned primary
 * sandbox / project read them off this response once at setup time.
 */
export interface UserProfile {
  user_id: string;
  display_name: string;
  /** Auto-provisioned primary sandbox id, surfaced for first-run setup. */
  sandbox_id?: string;
  /** Auto-provisioned default project id inside ``sandbox_id``. */
  project_id?: string;
}
