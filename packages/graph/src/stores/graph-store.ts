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
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
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
  error: string | null;
  mode: GraphMode;
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
  selectNode: (id: string | null) => void;
  hoverNode: (id: string | null) => void;
  setHighlightedNodes: (ids: string[]) => void;
  setSearchQuery: (query: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setMode: (mode: GraphMode) => void;
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
  error: null,
  mode: 'semantic',
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

  setGraphData: (nodes, edges, clusters) => set({ nodes, edges, clusters, hiddenClusters: new Set() }),
  selectNode: (id) => set({ selectedNodeId: id }),
  hoverNode: (id) => set({ hoveredNodeId: id }),
  setHighlightedNodes: (ids) => set({ highlightedNodeIds: new Set(ids) }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setMode: (mode) => set({ mode }),
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
