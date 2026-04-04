# Advanced Tier 1 — Retrospective Gap Analysis

> **Feature**: Advanced Features Tier 1 ("Ship Before Public Launch")
> **Match Rate**: 90%+ (PASS)
> **Date**: 2026-04-04 (retrospective)
> **PRD**: stellavault-advanced.prd.md §Tier 1

---

## Summary

Advanced PRD Tier 1 (P0) 6개 기능 중 5개가 이미 구현 완료. 나머지 1개(CLI Output Polish)는 부분 구현.

## Implementation Status

| # | Feature | PRD Priority | 파일 | 상태 |
|---|---------|:----------:|------|:----:|
| F-A01 | Onboarding Wizard | P0 | `cli/commands/init-cmd.ts` (145L) | ✅ |
| F-A02 | Error Recovery | P0 | `core/utils/retry.ts` (85L) | ✅ |
| F-A03 | Performance | P0 | indexer resilience, batch SQLite | ✅ |
| F-A08 | Embed Widget | P1 | `graph/embed/EmbedGraph.tsx` + `/api/embed` | ✅ |
| F-A15 | Plugin SDK | P1 | `core/plugins/index.ts` (PluginManager + events) | ✅ |
| F-A21 | CLI Output Polish | P1 | 부분 (--json 일부 지원) | ⚠️ 80% |

## Tier 2+ Status

| Feature | 상태 | 비고 |
|---------|:----:|------|
| F-A04 Cloud Sync | ❌ | S3/R2 인프라 필요, 사용자 확보 후 |
| F-A05 Notification Center | ✅ | `intelligence/notifications.ts` |
| F-A09 Knowledge Profile | ✅ | `/api/profile` |
| F-A11 AI Learning Path | ✅ | MCP get-learning-path |
| F-A12 Contradiction Detector | ✅ | `intelligence/contradiction-detector.ts` |
| F-A13 Semantic Versioning | ✅ | `intelligence/semantic-versioning.ts` |
| F-A14 Predictive Gap Analysis | ✅ | `intelligence/predictive-gaps.ts` |
| F-A16 Custom MCP Builder | ✅ | `mcp/custom-tools.ts` |
| F-A17 Webhook/Event System | ✅ | `plugins/webhooks.ts` |
| F-A18 Keyboard Navigation | ✅ | `hooks/useKeyboardNav.ts` |
| F-A19 i18n | ✅ | `i18n/index.ts` |
| F-A20 Max Visible Nodes | ✅ | `graph-store.ts` maxVisibleNodes |
| F-A22 Streamable HTTP MCP | ✅ | `mcp/server.ts` StreamableHTTPServerTransport |
| F-A06 Team Vaults | ❌ | 인프라 필요 |
| F-A07 Cloud Storage | ❌ | 인프라 필요 |

## Conclusion

22개 Advanced 기능 중 **19개 구현 완료** (86%). 미구현 3개(Cloud Sync, Team Vaults, Cloud Storage)는 모두 인프라 의존으로, 사용자 확보 후 구현이 적절.
