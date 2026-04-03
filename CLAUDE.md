# Stellavault — Project Rules

## Project Info
- **Name**: Stellavault (분산 지식 인텔리전스 플랫폼)
- **GitHub**: https://github.com/Evanciel/stellavault
- **Stack**: Node.js 20+, TypeScript, ESM, Monorepo (npm workspaces)
- **Packages**: core, cli, graph, sync

## Autopilot 추가 규칙

### Threat Model Gate (Phase 6 필수)

모든 기능 구현 후 Quality Gate에서 반드시 아래 질문을 검증할 것:

1. **악의적 입력**: 이 기능에 가짜/오염된 데이터를 넣으면 어떻게 되는가?
2. **서비스 거부**: 이 기능을 대량으로 호출하면 시스템이 멈추는가?
3. **프라이버시 유출**: 이 기능이 의도치 않게 개인 정보를 노출하는가?
4. **신뢰 악용**: 이 기능의 신뢰 메커니즘을 우회할 수 있는가?
5. **데이터 무결성**: 이 기능이 기존 데이터를 손상시킬 수 있는가?

위협 발견 시:
- Critical → 구현 중단, 방어 로직 추가 후 재검증
- Medium → Phase 7(Iterate)에서 방어 추가
- Low → 이슈로 기록, 다음 사이클에서 처리

### Federation 보안 원칙

- 원문 텍스트는 절대 네트워크 전송 금지
- 검색 결과: 제목 + 유사도 + 50자 스니펫만
- blocked 노드(reputation=0)의 결과는 필터링
- 새 노드는 neutral(40점)에서 시작, 자동 평판 적립

### 코드 컨벤션

- Design reference: `// Design Ref: §{section} — {rationale}`
- Success criteria: `// Plan SC: {criteria being addressed}`
- Federation 메시지: JSON + newline delimiter
- 에러 처리: StellavaultError with code + suggestion
- i18n: 사용자 노출 문자열은 t() 함수 사용 권장
