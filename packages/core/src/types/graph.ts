// Design Ref: §3.1 — Graph Data Types

export interface GraphNode {
  id: string;
  label: string;
  filePath: string;
  tags: string[];
  clusterId: number;
  position?: [number, number, number];
  size: number;
  source?: string;
  type?: string;
  lastModified?: string;
  // ─── Cluster-view fields (set only on flattened super-nodes, see graph-data.ts flattenClusterLevel) ───
  /** true when this GraphNode is a folded cluster super-node (id `cluster:<N>`). */
  isCluster?: boolean;
  /** # of notes folded into this super-node (drives label + size). */
  memberCount?: number;
  /** Most-connected member id (opened on drill-down). */
  representativeId?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface Cluster {
  id: number;
  label: string;
  color: string;
  nodeCount: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Cluster[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    clusterCount: number;
  };
}

export interface GraphResponse {
  data: GraphData;
  generatedAt: string;
  cacheKey: string;
}

// ─── Wave 1: Cluster-first LOD (docs/02-design/graph-scale-lod-redesign.md §2) ───
// A 12k-node vault renders as a small set of cluster "super-nodes"; the user expands
// one to stream its members. Nothing is truncated — every note belongs to a cluster.

/** A community/cluster rendered as ONE node at the galaxy (L0) level. */
export interface ClusterSuperNode {
  clusterId: number;
  label: string;
  color: string;
  memberCount: number;
  /** Deterministic galaxy position (renderer may settle it). */
  position: [number, number, number];
  /** Super-node visual size — a function of memberCount. */
  size: number;
  /** Most-connected member; opened on super-node double-click. */
  representativeId: string;
}

/** A rolled-up edge between two clusters. weight = Σ underlying inter-cluster edge weights. */
export interface MetaEdge {
  sourceCluster: number;
  targetCluster: number;
  weight: number;
  count: number;
}

/** `graph:clusters` payload — the L0 galaxy (≤~200 super-nodes, tiny). */
export interface ClusterLevelGraph {
  level: 'galaxy';
  superNodes: ClusterSuperNode[];
  metaEdges: MetaEdge[];
  totalNodes: number;
  totalEdges: number;
  /** Cache/invalidation key, e.g. "semantic@7". */
  layoutVersion: string;
}

/** `graph:expand-cluster` payload — one cluster's members + internal edges. */
export interface ClusterMembersGraph {
  clusterId: number;
  members: GraphNode[];
  intraEdges: GraphEdge[];
  boundaryEdges: Array<{ source: string; targetCluster: number; weight: number }>;
}
