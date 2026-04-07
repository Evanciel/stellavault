# Stellavault × Claude Code Hooks Setup

카파시의 자가 진화 메모리 시스템을 Claude Code에 연결합니다.
세션이 끝날 때마다 대화 요약이 자동으로 vault에 저장되고, wiki가 갱신됩니다.

## 1. Claude Code settings.json에 hooks 추가

`~/.claude/settings.json` (또는 프로젝트 `.claude/settings.json`):

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "stellavault session-save --summary \"$CLAUDE_SESSION_SUMMARY\""
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "stellavault session-save --summary \"Session ended. Key takeaways from this conversation.\""
          }
        ]
      }
    ]
  }
}
```

## 2. 수동 세션 저장

대화 중 아무 때나:
```bash
stellavault session-save --summary "오늘 인증 시스템 설계 완료. JWT+refresh token 채택."
```

또는 파이프:
```bash
echo "세션 요약 내용" | stellavault session-save
```

## 3. Daily Log → Wiki 플러시

daily logs가 쌓이면:
```bash
stellavault flush
```

출력:
```
Found 5 daily logs
Total sessions: 12
Flush complete!
  Wiki articles: 24
  Concepts extracted: 8
  Top concepts: auth, database, api, ...
  Health score: 85/100
```

## 4. 자동 플러시 (cron)

매일 자정에 자동 플러시:
```bash
# Linux/Mac
echo "0 0 * * * stellavault flush" | crontab -

# Windows (Task Scheduler)
schtasks /create /sc daily /tn "StellavaultFlush" /tr "stellavault flush" /st 00:00
```

## 복리 루프 (Compounding Loop)

```
세션 대화 → session-save → daily-log → flush → wiki 갱신
    ↑                                              ↓
    └──── Claude가 wiki 참조하여 더 정확한 답변 ←───┘
```

시간이 갈수록 Claude가 당신의 프로젝트를 더 깊이 이해합니다.
