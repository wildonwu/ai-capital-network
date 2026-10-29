export type Layer = 'capital' | 'commercial' | 'delivery' | 'financing' | 'support' | 'warrant' | 'affiliation';
export const LAYERS: Layer[] = ['capital', 'commercial', 'delivery', 'financing', 'support', 'warrant', 'affiliation'];

export interface GraphNode { id: string; label_raw: string; label_en: string; kind: 'core' | 'company' | 'project' | 'funding_category' | string }
export interface GraphEdge {
  id: string; from: string; to: string; layer: Layer; label: string; source: string;
  amount: number | null; unit: string; status: string; october_change: boolean; note: string; deal_id: string | null;
}
export interface Graph {
  schema_version: string; release_id: string; as_of: string; release_type: string; core: string[];
  nodes: GraphNode[]; edges: GraphEdge[]; coverage: Record<string, string>;
  historical_amount_policy: string; data_quality_notice: string;
}
export interface Source { published_at: string; quote: string; access: string; date_precision: string; sha256?: string; urls: string[]; archive_included: boolean }
export interface ViewManifest {
  release_id: string; view_id: string; node_ids: string[]; edge_ids: string[];
  nodes: Record<string, { label: string; box: [number, number, number, number] }>;
  edges: Record<string, unknown>; omissions: { id: string; reason: string }[];
  coordinate_system: { width: number; height: number; origin: string; node_box_format: string }; note: string;
}
export interface Manifest {
  release_id: string; schema_version: string; app_schema: string; release_type: string; as_of: string; as_of_label: string;
  published_at: string; previous_release_id: string | null; default_view: string; views: string[];
  files: Record<string, { sha256: string; bytes: number }>; counts: { nodes: number; relationships: number; sources: number }; coverage_note: string;
}
export interface Release {
  manifest: Manifest; graph: Graph; sources: Record<string, Source>; views: Record<string, ViewManifest>; hashVerified: boolean;
}
