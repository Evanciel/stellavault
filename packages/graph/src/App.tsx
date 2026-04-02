import { Layout } from './components/Layout.js';
import { useGraph } from './hooks/useGraph.js';

export function App() {
  useGraph(); // 그래프 데이터 자동 로딩
  return <Layout />;
}
