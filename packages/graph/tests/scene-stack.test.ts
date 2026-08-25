import { describe, it, expect, beforeEach } from 'vitest';
import { useGraphStore, type SceneFrame } from '../src/stores/graph-store.js';

function n(id: string, isCluster = false) {
  return { id, label: id, filePath: `${id}.md`, tags: [], clusterId: 0, size: 1, ...(isCluster ? { isCluster: true } : {}) };
}
const frame = (over: Partial<SceneFrame> = {}): SceneFrame => ({
  kind: 'folder', key: 'p', label: 'p', nodes: [n('x'), n('y')], edges: [], baked: false, ...over,
});

describe('씬 스택', () => {
  beforeEach(() => {
    useGraphStore.getState().setGraphData([n('a'), n('b'), n('c')], [], []);
  });

  it('setGraphData(= 새 fetch)는 스택을 비우고 새 기준 씬을 세운다', () => {
    useGraphStore.getState().pushScene(frame());
    useGraphStore.getState().setGraphData([n('z')], [], []);
    const s = useGraphStore.getState();
    expect(s.sceneStack).toEqual([]);
    expect(s.baseScene?.nodes.map((x) => x.id)).toEqual(['z']);
  });

  it('첫 노드가 슈퍼노드면 baked — 레이아웃을 돌리면 안 되는 씬', () => {
    useGraphStore.getState().setGraphData([n('cluster:0', true), n('a')], [], []);
    expect(useGraphStore.getState().sceneBaked).toBe(true);
  });

  it('pushScene → popScene 왕복이 기준 씬을 그대로 복원한다', () => {
    useGraphStore.getState().pushScene(frame());
    expect(useGraphStore.getState().nodes.map((x) => x.id)).toEqual(['x', 'y']);
    useGraphStore.getState().popScene();
    expect(useGraphStore.getState().nodes.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(useGraphStore.getState().sceneStack).toEqual([]);
  });

  it('여러 겹 쌓아도 한 겹씩 되돌아간다 (폴더 드릴다운의 모양)', () => {
    const st = useGraphStore.getState();
    st.pushScene(frame({ key: '08_Patterns', label: '08_Patterns' }));
    st.pushScene(frame({ key: '08_Patterns/concepts', label: 'concepts', nodes: [n('q')] }));
    expect(useGraphStore.getState().sceneStack.map((f) => f.label)).toEqual(['08_Patterns', 'concepts']);
    useGraphStore.getState().popScene();
    expect(useGraphStore.getState().nodes.map((x) => x.id)).toEqual(['x', 'y']);
    useGraphStore.getState().resetScene();
    expect(useGraphStore.getState().nodes.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('빈 스택에서 popScene 은 아무것도 하지 않는다', () => {
    useGraphStore.getState().popScene();
    expect(useGraphStore.getState().nodes.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  // ★이게 없어서 실제로 깨졌던 자리다. 레이아웃 워커는 배치가 수렴할 때까지 progress 를 여러 번
  // 보내는데, 그 콜백이 setGraphData 를 쓰고 있었다 — 드릴인한 지 한 틱 만에 스택이 날아가
  // 뒤로가기와 빵부스러기가 통째로 사라졌다. 라이브에서 stack:[] 로 관측하고 잡았다.
  it('레이아웃 위치 반영은 스택을 건드리지 않는다', () => {
    useGraphStore.getState().pushScene(frame());
    const moved = useGraphStore.getState().nodes.map((x) => ({ ...x, position: [1, 2, 3] as [number, number, number] }));
    useGraphStore.getState().applyLayoutPositions(moved);
    const s = useGraphStore.getState();
    expect(s.sceneStack).toHaveLength(1);
    expect(s.nodes[0].position).toEqual([1, 2, 3]);
  });

  it('레이아웃 위치는 프레임에도 새겨진다 — 들어갔다 나왔다 해도 다시 풀지 않게', () => {
    const st = useGraphStore.getState();
    st.pushScene(frame({ key: 'outer', label: 'outer' }));
    st.applyLayoutPositions(useGraphStore.getState().nodes.map((x) => ({ ...x, position: [9, 9, 9] as [number, number, number] })));
    useGraphStore.getState().pushScene(frame({ key: 'inner', label: 'inner', nodes: [n('q')] }));
    useGraphStore.getState().popScene();
    expect(useGraphStore.getState().nodes.every((x) => x.position?.[0] === 9)).toBe(true);
  });

  it('스택이 비었을 때의 위치 반영은 baseScene 에 새겨진다', () => {
    useGraphStore.getState().applyLayoutPositions(
      useGraphStore.getState().nodes.map((x) => ({ ...x, position: [4, 5, 6] as [number, number, number] })),
    );
    useGraphStore.getState().pushScene(frame());
    useGraphStore.getState().popScene();
    expect(useGraphStore.getState().nodes.every((x) => x.position?.[1] === 5)).toBe(true);
  });

  it('cluster 프레임만 focusedClusterId 를 세운다 (폴더·로컬은 클러스터가 아니다)', () => {
    useGraphStore.getState().pushScene(frame({ kind: 'cluster', key: '7', label: 'c7' }));
    expect(useGraphStore.getState().focusedClusterId).toBe(7);
    useGraphStore.getState().pushScene(frame({ kind: 'local', key: 'a', label: 'a' }));
    expect(useGraphStore.getState().focusedClusterId).toBe(7); // 클러스터 안에서 로컬로 들어간 상태
    useGraphStore.getState().popScene();
    useGraphStore.getState().popScene();
    expect(useGraphStore.getState().focusedClusterId).toBeNull();
  });

  it('drill-in 하면 이전 화면의 선택은 버린다 (그 노드가 새 씬에 없을 수 있다)', () => {
    useGraphStore.getState().selectNode('a');
    useGraphStore.getState().pushScene(frame());
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });

  it('localDepth 는 1~4 로 잠긴다', () => {
    useGraphStore.getState().setLocalDepth(0);
    expect(useGraphStore.getState().localDepth).toBe(1);
    useGraphStore.getState().setLocalDepth(99);
    expect(useGraphStore.getState().localDepth).toBe(4);
  });
});
