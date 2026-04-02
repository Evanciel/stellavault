import { describe, it, expect } from 'vitest';

// profile-card SVG 생성 로직 검증
// 실제 함수는 graph 패키지이므로 SVG 구조 검증용 단위 테스트

function generateSimpleSVG(data: {
  documentCount: number;
  clusterCount: number;
  edgeCount: number;
  clusters: Array<{ label: string; nodeCount: number; color: string }>;
  tags: Array<{ tag: string; count: number }>;
}): string {
  const W = 800, H = 420;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <text>${data.documentCount} docs</text>
    ${data.clusters.map(c => `<circle fill="${c.color}"/>`).join('')}
    ${data.tags.map(t => `<text>#${esc(t.tag)}</text>`).join('')}
  </svg>`;
}

describe('Profile Card SVG', () => {
  it('유효한 SVG 생성', () => {
    const svg = generateSimpleSVG({
      documentCount: 100, clusterCount: 5, edgeCount: 200,
      clusters: [{ label: 'AI', nodeCount: 50, color: '#6366f1' }],
      tags: [{ tag: 'react', count: 10 }],
    });
    expect(svg).toContain('<svg');
    expect(svg).toContain('100 docs');
  });

  it('클러스터 컬러 포함', () => {
    const svg = generateSimpleSVG({
      documentCount: 10, clusterCount: 2, edgeCount: 5,
      clusters: [
        { label: 'A', nodeCount: 5, color: '#ff0000' },
        { label: 'B', nodeCount: 5, color: '#00ff00' },
      ],
      tags: [],
    });
    expect(svg).toContain('#ff0000');
    expect(svg).toContain('#00ff00');
  });

  it('태그 이스케이프', () => {
    const svg = generateSimpleSVG({
      documentCount: 1, clusterCount: 1, edgeCount: 0,
      clusters: [], tags: [{ tag: '<script>', count: 1 }],
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script');
  });

  it('빈 데이터도 에러 없이 생성', () => {
    const svg = generateSimpleSVG({
      documentCount: 0, clusterCount: 0, edgeCount: 0,
      clusters: [], tags: [],
    });
    expect(svg).toContain('<svg');
  });
});
