/** Search result row — minimal public projection.
 *
 * Search-only fields (`similarity`, `record_type`) are kept because the
 * CLI surfaces them when ranking candidates. Internal ontology fields
 * (`origin_priority`, `node_count`, `behavior_count`, `semantic_tags`)
 * are not exposed.
 */
export interface CanonicalEntity {
  canonical_id: string;
  name: string;
  similarity?: number;
  record_type?: string;
}
