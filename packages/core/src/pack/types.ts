// Design Ref: Phase 3 §1 — .sv-pack.json 표준 포맷

export interface KnowledgePack {
  name: string;
  version: string;
  author: string;
  license: string;
  description: string;
  tags: string[];
  embeddingModel: string;
  embeddingDimensions: number;
  schemaVersion: string;
  chunks: PackChunk[];
  createdAt: string;
}

export interface PackChunk {
  id: string;
  content: string;
  heading: string;
  embedding: number[];
  metadata: {
    sourceFile: string;
    category: string;
    language?: string;
    framework?: string;
  };
}

export interface PackInfo {
  name: string;
  version: string;
  author: string;
  license: string;
  description: string;
  chunkCount: number;
  embeddingModel: string;
  createdAt: string;
}
