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
