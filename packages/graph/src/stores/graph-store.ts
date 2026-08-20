// Design Ref: §10.1 — zustand (R3F 렌더 루프 충돌 방지)

import { create } from 'zustand';

interface GraphNode {
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
  // Cluster-view fields — mirror packages/core types/graph.ts GraphNode (duplicated interface).
  isCluster?: boolean;
  memberCount?: number;
  representativeId?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  /** Mirrors packages/core types/graph.ts GraphEdge.kind — absent means 'semantic'. */
  kind?: 'link' | 'semantic';
}

/**
 * Which of the two edge classes the scene draws. GraphEdges partitions its buffer link-edges-first,
 * so switching this is a geometry.setDrawRange (two numbers) — no rebuild, no reallocation.
 */
export type EdgeFilter = 'both' | 'links' | 'semantic';

/**
 * 씬 스택 한 칸. 클러스터 드릴다운 / 폴더 하위 드릴다운 / 로컬 그래프가 전부 "지금 보고 있는
 * 노드 집합을 다른 것으로 갈아끼운다"는 같은 동작이라, 각자 되돌아가는 길을 따로 만드는 대신
 * 한 스택으로 모았다. 뒤로가기와 빵부스러기(breadcrumb)가 여기서 공짜로 나온다.
 *
 * nodes/edges 는 복사가 아니라 참조다. raw 기준 씬은 17,342 노드 + 72,735 엣지라 프레임마다
 * 복사하면 스택 깊이만큼 곱해진다.
 */
export interface SceneFrame {
  kind: 'cluster' | 'folder' | 'local' | 'tag';
  /** 이 프레임을 식별하는 키 — 클러스터 id / 폴더 경로 / 루트 노트 id. */
  key: string;
  /** breadcrumb 에 그대로 찍히는 문자열. */
  label: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /**
   * 폴더 프레임이 더 깊이 파고들 때 쓰는 원본 멤버 집합.
   *
   * 화면의 `nodes` 는 하위 폴더가 슈퍼노드로 접힌 결과라, 거기서는 한 계단 더 내려갈 수 없다.
   * (접힌 폴더 안의 파일 목록이 사라졌으므로.) 접기 전 집합을 같이 들고 다닌다.
   */
  pool?: { nodes: GraphNode[]; edges: GraphEdge[] };
  /** 폴더 프레임이 서 있는 경로 — 다음 계단의 접두사. */
  folderPath?: string;
  /**
   * 위치가 서버에서 구워져 온 씬인가. true 면 force 레이아웃을 돌리면 안 된다.
   *
   * 예전에는 `nodes[0].isCluster` 로 판정했다 — 위치가 아니라 "0번 노드가 슈퍼노드인가" 라는
   * 우연에 기댄 검사라, 폴더 드릴다운처럼 슈퍼노드와 일반 노트가 섞인 씬에서는 0번이 무엇이냐에
   * 따라 레이아웃이 통째로 스킵돼 전부 원점에 쌓인다. 명시 플래그로 바꾼다.
   */
  baked?: boolean;
}

interface Cluster {
  id: number;
  label: string;
  color: string;
  nodeCount: number;
}

type GraphMode = 'semantic' | 'folder';

interface GraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: Cluster[];
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  highlightedNodeIds: Set<string>;
  searchQuery: string;
  loading: boolean;
  // 콜드 빌드 진행률(/api/graph/status). 전량 스케일에서 첫 빌드가 실측 27초라 무표시 스피너면
  // 멈춘 것과 구분이 안 된다 — 어느 단계에서 얼마나 왔는지 보여준다.
  buildProgress: { phase: string; done: number; total: number } | null;
  error: string | null;
  mode: GraphMode;
  // view: cluster (default — folded super-node galaxy) vs raw (every individual note).
  // Orthogonal to mode; drives /api/graph?view=. rawCap caps the raw "All nodes" fetch —
  // "전체 노드" 가 전체가 아니면 버튼이 거짓말을 하는 것이라 서버 캡 화이트리스트 상단과
  // 맞춰 둔다(server.ts CAP_STEPS_RAW).
  view: 'cluster' | 'raw';
  rawCap: number;
  // Bumped to force useGraph to re-fetch the cluster galaxy even when `view` is unchanged —
  // a drilldown stays on view='cluster' (members in place), so "← All clusters" can't rely on
  // a view change to refetch; reloadGalaxy() bumps this.
  galaxyNonce: number;
  // Which cluster the scene is currently drilled INTO (null = the whole galaxy / raw view).
  // `clusters` deliberately keeps the FULL galaxy list while drilled in (the drilldown needs it
  // for neighbour labels + colours), so without this flag the StatusBar reported "35 clusters"
  // while the screen showed the members of exactly one. Set by drilldown, cleared by
  // reloadGalaxy / any view change.
  focusedClusterId: number | null;
  /** 드릴인 스택. 비어 있으면 baseScene(= 마지막 fetch 결과)을 보고 있는 것이다. */
  sceneStack: SceneFrame[];
  /** 스택이 빌 때 돌아갈 씬. setGraphData(= 새 fetch)가 이걸 갱신하고 스택을 비운다. */
  baseScene: { nodes: GraphNode[]; edges: GraphEdge[]; baked: boolean } | null;
  /** 현재 씬의 위치가 서버 baked 인가 — useLayout 이 force 워커를 건너뛸지 결정한다. */
  sceneBaked: boolean;
  /** 로컬 그래프 홉 수 (kind:'local' 프레임에서만 의미 있음). */
  localDepth: number;
  /** 태그를 노드로 합성해 보여줄지. */
  showTagNodes: boolean;
  pulseParticlePos: [number, number, number] | null;
  hiddenClusters: Set<number>;
  theme: 'dark' | 'light';
  isExporting: boolean;
  isRecording: boolean;
  lodLevel: 'universe' | 'constellation' | 'note';
  showDecayOverlay: boolean;
  decayData: Record<string, number>;
  // Design Ref: §1.1 — F06 Heatmap + F01 Gap UI
  showHeatmap: boolean;
  heatmapData: Record<string, number>; // nodeId → activityScore (0~1)
  showGaps: boolean;
  gapData: {
    gaps: Array<{ clusterIdA: number; clusterIdB: number; bridgeCount: number; severity: 'high' | 'medium' | 'low' }>;
    isolatedNodeIds: Set<string>;
  } | null;
  showConstellation: boolean;
  // Wiki links vs AI semantic similarity. Default 'both' — the two classes are drawn in one pass.
  edgeFilter: EdgeFilter;
  hiddenTypes: Set<string>;
  showTimeline: boolean;
  timelineRange: [number, number] | null; // [startMs, endMs] or null = show all
  searchHistory: string[];
  maxVisibleNodes: number; // performance cap for large vaults
  locale: 'en' | 'ko' | 'ja' | 'zh';
  setLocale: (locale: 'en' | 'ko' | 'ja' | 'zh') => void;
  viewMode: 'universe' | 'multiverse';
  federationPeers: Array<{ peerId: string; displayName: string; documentCount: number; topTopics: string[] }>;
  setViewMode: (mode: 'universe' | 'multiverse') => void;
  setFederationPeers: (peers: Array<{ peerId: string; displayName: string; documentCount: number; topTopics: string[] }>) => void;

  setGraphData: (nodes: GraphNode[], edges: GraphEdge[], clusters: Cluster[]) => void;
  /**
   * 레이아웃 워커가 푼 위치만 반영한다.
   *
   * 예전에는 이것도 setGraphData 로 썼다. 그런데 setGraphData 는 "새 fetch 결과"라는 뜻이라
   * sceneStack 을 비우고 baseScene 을 갈아치운다 — 워커는 배치가 수렴할 때까지 progress 를
   * 여러 번 보내므로, 드릴인한 지 한 틱 만에 스택이 날아가 뒤로가기와 빵부스러기가 사라졌다.
   * (hiddenClusters 도 매 틱 초기화됐다.) 위치는 씬의 정체성을 바꾸지 않으므로 따로 뺀다.
   */
  applyLayoutPositions: (nodes: GraphNode[]) => void;
  selectNode: (id: string | null) => void;
  hoverNode: (id: string | null) => void;
  setHighlightedNodes: (ids: string[]) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
  setBuildProgress: (p: { phase: string; done: number; total: number } | null) => void;
  setError: (error: string | null) => void;
  setMode: (mode: GraphMode) => void;
  setView: (view: 'cluster' | 'raw') => void;
  setRawCap: (cap: number) => void;
  /** Return to the folded cluster galaxy (un-drill) — forces a refetch via galaxyNonce. */
  reloadGalaxy: () => void;
  /** Mark the scene as drilled into `id` (null = back at the galaxy / raw view). */
  setFocusedCluster: (id: number | null) => void;
  /** 한 단계 파고든다 — 프레임을 쌓고 화면을 그 노드 집합으로 바꾼다. */
  pushScene: (frame: SceneFrame) => void;
  /** 한 단계 되돌아간다. 스택이 비면 baseScene 으로 복귀한다. */
  popScene: () => void;
  /** 스택을 통째로 비우고 baseScene 으로 복귀한다. */
  resetScene: () => void;
  setLocalDepth: (d: number) => void;
  toggleTagNodes: () => void;
  setPulseParticlePos: (pos: [number, number, number] | null) => void;
  toggleHiddenCluster: (id: number) => void;
  toggleTheme: () => void;
  setExporting: (v: boolean) => void;
  setRecording: (v: boolean) => void;
  setLodLevel: (level: 'universe' | 'constellation' | 'note') => void;
  toggleDecayOverlay: () => void;
  setDecayData: (data: Record<string, number>) => void;
  toggleHeatmap: () => void;
  setHeatmapData: (data: Record<string, number>) => void;
  toggleGaps: () => void;
  setGapData: (data: GraphState['gapData']) => void;
  toggleConstellation: () => void;
  setEdgeFilter: (filter: EdgeFilter) => void;
  toggleHiddenType: (type: string) => void;
  toggleTimeline: () => void;
  setTimelineRange: (range: [number, number] | null) => void;
  addSearchHistory: (query: string) => void;
  clearSearchHistory: () => void;
}

export const useGraphStore = create<GraphState>((set) => ({
  nodes: [],
  edges: [],
  clusters: [],
  selectedNodeId: null,
  hoveredNodeId: null,
  highlightedNodeIds: new Set(),
  searchQuery: '',
  loading: false,
  buildProgress: null,
  error: null,
  mode: 'semantic',
  view: 'cluster' as const,
  rawCap: 20000,
  galaxyNonce: 0,
  focusedClusterId: null,
  sceneStack: [],
  baseScene: null,
  sceneBaked: false,
  localDepth: 2,
  showTagNodes: false,
  pulseParticlePos: null,
  hiddenClusters: new Set(),
  theme: 'dark',
  isExporting: false,
  isRecording: false,
  lodLevel: 'constellation' as const,
  showDecayOverlay: false,
  decayData: {},
  showHeatmap: false,
  heatmapData: {},
  showGaps: false,
  gapData: null,
  showConstellation: true,
  edgeFilter: 'both' as const,
  hiddenTypes: new Set(),
  showTimeline: false,
  timelineRange: null,
  searchHistory: (typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('sv_search_history') ?? '[]') : []) as string[],
  maxVisibleNodes: 5000,
  locale: (typeof localStorage !== 'undefined' ? localStorage.getItem('sv_locale') as any : null) ?? 'en',
  setLocale: (locale) => { localStorage.setItem('sv_locale', locale); set({ locale }); },
  viewMode: 'universe' as const,
  federationPeers: [],
  setViewMode: (mode) => set({ viewMode: mode }),
  setFederationPeers: (peers) => set({ federationPeers: peers }),

  // 새 fetch 결과 = 새 기준 씬. 드릴인 스택은 여기서 초기화된다(예전 씬으로 돌아갈 길이
  // 사라졌으므로 스택을 남겨두면 뒤로가기가 없어진 노드 집합을 복원하려 든다).
  // baked = 서버가 위치를 구워 보낸 클러스터 갤럭시. 첫 노드가 슈퍼노드면 갤럭시다 —
  // 이 판정은 fetch 직후 여기서 딱 한 번만 하고, 이후에는 sceneBaked 플래그로 전파한다.
  setGraphData: (nodes, edges, clusters) => {
    const baked = nodes[0]?.isCluster === true;
    return set({
      nodes, edges, clusters,
      hiddenClusters: new Set(),
      baseScene: { nodes, edges, baked },
      sceneStack: [],
      sceneBaked: baked,
      focusedClusterId: null,
    });
  },
  applyLayoutPositions: (nodes) => set((st) => {
    const stack = st.sceneStack;
    const top = stack[stack.length - 1];
    // 지금 보고 있는 프레임(없으면 baseScene)에도 같이 새겨둔다. 안 그러면 한 칸 들어갔다
    // 뒤로 나왔을 때 아직 안 풀린 옛 위치로 되돌아가 전부 다시 배치된다.
    if (top) {
      return { nodes, sceneStack: [...stack.slice(0, -1), { ...top, nodes }] };
    }
    return st.baseScene
      ? { nodes, baseScene: { ...st.baseScene, nodes } }
      : { nodes };
  }),
  pushScene: (frame) => set((st) => ({
    sceneStack: [...st.sceneStack, frame],
    nodes: frame.nodes,
    edges: frame.edges,
    sceneBaked: frame.baked === true,
    // 드릴인하면 이전 화면의 선택/하이라이트는 의미가 없다 — 그 노드가 새 씬에 없을 수 있다.
    selectedNodeId: null,
    hoveredNodeId: null,
    focusedClusterId: frame.kind === 'cluster' ? Number(frame.key) : st.focusedClusterId,
  })),
  popScene: () => set((st) => {
    if (st.sceneStack.length === 0) return {};
    const next = st.sceneStack.slice(0, -1);
    const top = next[next.length - 1];
    const scene = top ?? st.baseScene;
    if (!scene) return {};
    const stillInCluster = [...next].reverse().find((f) => f.kind === 'cluster');
    return {
      sceneStack: next,
      nodes: scene.nodes,
      edges: scene.edges,
      sceneBaked: (top ? top.baked : st.baseScene?.baked) === true,
      selectedNodeId: null,
      hoveredNodeId: null,
      focusedClusterId: stillInCluster ? Number(stillInCluster.key) : null,
    };
  }),
  resetScene: () => set((st) => {
    if (!st.baseScene) return { sceneStack: [] };
    return {
      sceneStack: [],
      nodes: st.baseScene.nodes,
      edges: st.baseScene.edges,
      sceneBaked: st.baseScene.baked,
      selectedNodeId: null,
      hoveredNodeId: null,
      focusedClusterId: null,
    };
  }),
  setLocalDepth: (d) => set({ localDepth: Math.max(1, Math.min(4, Math.round(d))) }),
  toggleTagNodes: () => set((st) => ({ showTagNodes: !st.showTagNodes })),
  selectNode: (id) => set({ selectedNodeId: id }),
  hoverNode: (id) => set({ hoveredNodeId: id }),
  setHighlightedNodes: (ids) => set({ highlightedNodeIds: new Set(ids) }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLoading: (loading) => set({ loading, ...(loading ? {} : { buildProgress: null }) }),
  setBuildProgress: (p) => set({ buildProgress: p }),
  setError: (error) => set({ error }),
  // mode/view switches refetch a whole new scene, so any drill-in focus is stale — clear it
  // here rather than in every caller (a stale focus would leave the StatusBar claiming we are
  // inside a cluster while the galaxy or the raw hairball is on screen).
  setMode: (mode) => set({ mode, focusedClusterId: null }),
  setView: (view) => set({ view, focusedClusterId: null }),
  setRawCap: (cap) => set({ rawCap: cap }),
  reloadGalaxy: () => set((s) => ({ view: 'cluster', galaxyNonce: s.galaxyNonce + 1, focusedClusterId: null })),
  setFocusedCluster: (id) => set({ focusedClusterId: id }),
  setPulseParticlePos: (pos) => set({ pulseParticlePos: pos }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' as const })),
  setExporting: (v) => set({ isExporting: v }),
  setRecording: (v) => set({ isRecording: v }),
  setLodLevel: (level) => set({ lodLevel: level }),
  toggleDecayOverlay: () => set((s) => ({ showDecayOverlay: !s.showDecayOverlay, showHeatmap: false })),
  setDecayData: (data) => set({ decayData: data }),
  toggleHeatmap: () => set((s) => ({ showHeatmap: !s.showHeatmap, showDecayOverlay: false })),
  setHeatmapData: (data) => set({ heatmapData: data }),
  toggleGaps: () => set((s) => ({ showGaps: !s.showGaps })),
  setGapData: (data) => set({ gapData: data }),
  toggleConstellation: () => set((s) => ({ showConstellation: !s.showConstellation })),
  setEdgeFilter: (filter) => set({ edgeFilter: filter }),
  toggleHiddenCluster: (id) => set((s) => {
    const next = new Set(s.hiddenClusters);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { hiddenClusters: next };
  }),
  addSearchHistory: (query) => set((s) => {
    const filtered = s.searchHistory.filter((q) => q !== query);
    const next = [query, ...filtered].slice(0, 20);
    localStorage.setItem('sv_search_history', JSON.stringify(next));
    return { searchHistory: next };
  }),
  clearSearchHistory: () => set(() => {
    localStorage.removeItem('sv_search_history');
    return { searchHistory: [] };
  }),
  toggleTimeline: () => set((s) => ({ showTimeline: !s.showTimeline, timelineRange: s.showTimeline ? null : s.timelineRange })),
  setTimelineRange: (range) => set({ timelineRange: range }),
  toggleHiddenType: (type) => set((s) => {
    const next = new Set(s.hiddenTypes);
    if (next.has(type)) next.delete(type); else next.add(type);
    return { hiddenTypes: next };
  }),
}));
