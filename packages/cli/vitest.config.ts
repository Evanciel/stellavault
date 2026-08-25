import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 🔴 CLI 시험은 `@stellavault/core` 를 <소스로> 본다.
//
// 기본 해석은 workspace 링크를 따라 core 의 <빌드 산출물>(dist/)로 간다. 그러면
// core 소스를 고쳐도 CLI 시험은 옛 빌드를 재고, "초록" 이 지금 소스를 증명하지 않는다.
// 실측 2026-08-21: core 의 checkVaultOwnership 을 <항상 ok> 로 망가뜨렸는데
// CLI 시험이 전부 통과했다. 이 별칭이 없으면 판별력이 빌드 시점에 묶인다.
export default defineConfig({
  resolve: {
    alias: {
      '@stellavault/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
});
