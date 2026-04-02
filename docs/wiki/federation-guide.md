# Stellavault — Federation 네트워크 가이드

## Federation이란?

각 Stellavault 인스턴스가 P2P 네트워크의 노드가 되어,
다른 노드의 지식을 **임베딩 기반 시맨틱 검색**으로 탐색합니다.

**핵심 원칙: 원문은 절대 나가지 않습니다.**
공유되는 것: 제목 + 유사도 점수 + 50자 미리보기.

## Quick Start

```bash
# 터미널 A: 첫 번째 노드
stellavault federate join --name "my-node"

# 터미널 B: 두 번째 노드 (같은 PC, 다른 vault)
stellavault federate join --name "peer-node"

# 터미널 A에서:
federation> peers                      # 연결된 피어 확인
federation> search kubernetes deploy   # 연합 검색
federation> leave                      # 종료
```

## 명령어

| 명령어 | 설명 |
|--------|------|
| `sv federate join [--name]` | 네트워크 참여 (대화형 모드) |
| `sv federate status` | 노드 ID + 상태 확인 |

### 대화형 모드 명령어

| 명령어 | 설명 |
|--------|------|
| `search <query>` | 연합 시맨틱 검색 |
| `peers` | 연결된 피어 목록 |
| `status` | 내 노드 정보 |
| `connect <ip:port>` | 수동 IP 연결 (폴백) |
| `leave` | 종료 |
| `help` | 도움말 |

## 작동 원리

```
1. sv federate join
   → Hyperswarm DHT에 "stellavault-federation" 토픽으로 참여
   → 같은 토픽의 다른 노드 자동 발견

2. 핸드셰이크
   → 서로 peerId, 이름, 문서 수, 주요 토픽 교환

3. search "kubernetes"
   → 쿼리를 384차원 임베딩 벡터로 변환
   → 모든 피어에게 임베딩 전송 (병렬, 5초 타임아웃)
   → 각 피어가 로컬 DB에서 검색
   → 결과 반환: 제목 + 유사도 + 50자 스니펫
   → 전체 결과 병합 (유사도 순 정렬)
```

## 프라이버시

| 나가는 것 | 안 나가는 것 |
|----------|------------|
| 쿼리 임베딩 (384차원 벡터) | 원문 쿼리 텍스트 |
| 결과 제목 | 전체 문서 내용 |
| 유사도 점수 | 전체 임베딩 DB |
| 50자 스니펫 | 파일 경로, 태그 |

## 노드 ID

처음 `sv federate join` 하면 자동 생성:
- 저장: `~/.stellavault/federation/identity.json`
- 변경: 파일 삭제 후 재생성
- 이름: `--name` 옵션으로 지정

## 트러블슈팅

| 문제 | 해결 |
|------|------|
| "피어 발견 안 됨" | 같은 네트워크인지 확인. `connect <ip:port>` 시도 |
| 검색 결과 없음 | 피어가 인덱싱된 vault를 가지고 있는지 확인 |
| 연결 끊김 | Ctrl+C 후 재참여. Hyperswarm이 자동 재연결 시도 |
| 3초 초과 | 네트워크 속도 확인. 타임아웃은 5초 |
