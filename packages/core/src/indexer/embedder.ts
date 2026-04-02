// Design Ref: §3.2 — 교체 가능 설계 (Embedder 인터페이스)

export interface Embedder {
  initialize(): Promise<void>;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
  readonly modelName: string;
}
