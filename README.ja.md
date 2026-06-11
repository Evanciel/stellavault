<div align="center">

# ✦ Stellavault

**何でも放り込むだけ。自動で知識へとコンパイルされます。**<br/>
**Claude が記憶する** ローカルファースト(local-first)なセカンドブレイン — クラウド不要、APIキー不要、元ファイルは一切変更しません。

[![CI](https://github.com/Evanciel/stellavault/actions/workflows/ci.yml/badge.svg)](https://github.com/Evanciel/stellavault/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/stellavault)](https://www.npmjs.com/package/stellavault) [![tests](https://img.shields.io/badge/tests-245%20passing-brightgreen)]() [![node](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)]() [![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh.md)

[**⬇ デスクトップアプリをダウンロード**](https://github.com/Evanciel/stellavault/releases/tag/desktop-v0.1.0) · [クイックスタート](#インストール) · [MCP セットアップ](#mcp-連携-21ツール) · [ライブデモ](https://evanciel.github.io/stellavault/)

</div>

**自らをコンパイルするセカンドブレイン。** Stellavault は、知識はどう生き、どう育つべきかについての 2 つの思想を一つに溶け込ませました:

- 🧠 **Karpathy の自己コンパイル型 wiki** — 何でも(PDF、YouTube リンク、ふと浮かんだ考え)を放り込むと自動で抽出されて `raw/` に積まれ、概念とバックリンクが整理された綺麗な `_wiki/` へと **コンパイル** されます。知識はフォルダの中で腐るのではなく、積み重なるほど自らを再コンパイルします。
- 🕸️ **ツェッテルカステン(Zettelkasten)** — アトミックなノート、`[[ウィキリンク]]`、そして自然に育つつながり。フォルダツリーではなく *アイデアの網* こそが、あなたの思考を形づくる本当の骨格になります。

この 2 つを一つのローカルファーストな知識ツールに統合しました — 本格的なマークダウンエディタ、3D ニューラルグラフ、ハイブリッド AI 検索、間隔反復(spaced repetition)による記憶減衰まで。そのすべてが、**デスクトップアプリ**、**CLI**、**Obsidian プラグイン**、そして **Claude にあなたのボールト(vault)全体を読ませる MCP サーバー** として利用できます。クラウドも API キーも不要、元のファイルは決して変更されません。

<p align="center">
  <img src="images/screenshots/graph-main-2.png" alt="3D ナレッジグラフ" width="820" />
  <br><em>あなたのボールトを一つのニューラルネットワークに。ローカルファースト、クラウド不要。</em>
</p>

## 目次

[インストール](#インストール) · [エディタ](#エディタ) · [パイプライン](#パイプライン) · [インテリジェンス](#インテリジェンス) · [検索とランキング](#検索とランキング) · [MCP 連携](#mcp-連携-21ツール) · [3D ビジュアライゼーション](#3d-ビジュアライゼーション) · [設定](#設定) · [パフォーマンス](#パフォーマンス) · [技術スタック](#技術スタック) · [セキュリティ](#セキュリティ) · [トラブルシューティング](#トラブルシューティング)

## インストール

### デスクトップアプリ (推奨 — ワンクリック)

<table>
  <tr>
    <td align="center"><a href="https://github.com/Evanciel/stellavault/releases/download/desktop-v0.1.0/Stellavault-win32-x64-0.1.0.zip"><br/><b>⬇ Windows 版をダウンロード</b><br/><sub>x64 · 116 MB · ZIP</sub></a></td>
    <td align="center"><a href="https://github.com/Evanciel/stellavault/releases/download/desktop-v0.1.0/Stellavault-linux-x64-0.1.0.zip"><br/><b>⬇ Linux 版をダウンロード</b><br/><sub>x64 · 107 MB · ZIP</sub></a></td>
    <td align="center"><br/><b>macOS</b><br/><sub>近日公開</sub></td>
  </tr>
</table>

> ダウンロード → 解凍 → `stellavault.exe`(Windows) または `stellavault`(Linux) を実行 → ノートフォルダを選択 → 完了。

### CLI (開発者向け)

```bash
npm install -g stellavault    # または: npx stellavault
stellavault init              # 対話式セットアップ (3分): ボールトの索引化 + AI クライアント接続
stellavault setup             # Claude Code/Desktop, Cursor, Windsurf, VS Code に接続 (1コマンド)
stellavault graph             # ブラウザで 3D グラフを起動
```

> Node.js 20+ が必要です。問題が起きたら `stellavault doctor` で診断してください。

### Obsidian プラグイン

1. [stellavault-obsidian リリース](https://github.com/Evanciel/stellavault-obsidian/releases/latest)から `main.js` + `manifest.json` + `styles.css` をダウンロード
2. `.obsidian/plugins/stellavault/` に配置
3. 設定 → コミュニティプラグインで有効化
4. ボールトフォルダで API を起動: `npx stellavault graph`

---

## エディタ

本格的なマークダウンエディタ — Obsidian に匹敵します。

| 機能 | 状態 |
|---------|--------|
| 太字、斜体、下線、取り消し線 | ✅ |
| 見出し 1–6 | ✅ |
| 箇条書き・番号付き・タスクリスト (ネストしたチェックボックス) | ✅ |
| テーブル (作成、列幅調整、行・列の追加/削除) | ✅ |
| シンタックスハイライト付きコードブロック (40+ 言語) | ✅ |
| 画像 (URL、クリップボード貼り付け、ドラッグ＆ドロップ) | ✅ |
| KaTeX 数式レンダリング (`$E=mc^2$` インライン、`$$...$$` ディスプレイ) | ✅ |
| `/スラッシュコマンド` (12種のブロック、あいまい検索) | ✅ |
| `[[ウィキリンク]]` オートコンプリート | ✅ |
| 分割ビュー (垂直 + 水平、Ctrl+\\) | ✅ |
| テキスト整列 (左 / 中央 / 右) | ✅ |
| ハイライト、上付き、下付き | ✅ |
| スマートタイポグラフィ (丸引用符、em/en ダッシュ) | ✅ |
| 水平線 | ✅ |

---

## パイプライン

```
収集 ──→ 整理 ──→ 蒸留 ──→ 表現
(Capture ──→ Organize ──→ Distill ──→ Express)

何でも放り込む → 自動抽出 → raw/ → コンパイル → _wiki/ → ドラフト
```

Karpathy の自己コンパイル型ナレッジアーキテクチャに着想を得ています。

### 14 フォーマットの取り込み(Ingest)

| 入力 | 方法 |
|-------|-----|
| PDF, DOCX, PPTX, XLSX | `stellavault ingest report.pdf` |
| JSON, CSV, XML, YAML, HTML, RTF | `stellavault ingest data.json` |
| YouTube | `stellavault ingest https://youtu.be/...` — 文字起こし + タイムスタンプ |
| URL | `stellavault ingest https://...` — HTML → マークダウン |
| テキスト | `stellavault ingest "ふと思ったこと"` |
| フォルダ | `stellavault ingest ./papers/` — 全ファイルを一括処理 |
| デスクトップ / Web UI | ファイルを直接ドラッグ＆ドロップ |

### 表現(Express): 知識を取り出す

```bash
stellavault draft "AI" --format blog      # ボールトを基にしたブログ記事
stellavault draft "AI" --format outline   # 構造化されたアウトライン
stellavault draft "AI" --ai              # Claude API で強化 ($0.03)
```

または、デスクトップアプリの **Express タブ** でトピックを入力しフォーマットを選ぶと、ボールトに基づいたドラフトを生成します。`_drafts/` に保存し、インラインで編集できます。

---

## インテリジェンス

> Obsidian にはプラグインを使っても **存在しない** 機能です。

| 機能 | コマンド / デスクトップ | 説明 |
|---------|-------------------|-------------|
| **記憶減衰(Memory Decay)** | `stellavault decay` / Memory タブ | FSRS ベース — あなたが忘れかけている実際のノートを示します |
| **知識のギャップ(Knowledge Gaps)** | `stellavault gaps` | トピッククラスタ間の弱い結びつきを検出 |
| **矛盾(Contradictions)** | `stellavault contradictions` | ボールト全体の相反する記述を発見 |
| **重複(Duplicates)** | `stellavault duplicates` | 類似度スコア付きでほぼ同一のノートを検出 |
| **ヘルスチェック(Health Check)** | `stellavault lint` | ボールトの健全性スコアを集計 (0–100) |
| **学習パス(Learning Path)** | `stellavault learn` | AI がパーソナライズした復習レコメンド |
| **デイリーブリーフ** | デスクトップアプリのホーム画面 | プッシュ型: アプリ起動時に減衰上位ノート + 統計を表示 |
| **自動タグ付け** | 取り込み時に自動 | コンテンツベースのキーワード抽出 + カテゴリルール |
| **自己コンパイル** | `stellavault compile` | raw/ → _wiki/ へ、概念抽出 + バックリンクを自動生成 |

---

## 検索とランキング

複数のシグナルを **重み付き RRF(Reciprocal Rank Fusion)** で融合するハイブリッド検索 — 個人のナレッジボールト向けにチューニングされ、完全ローカル、APIキー 0:

| シグナル | 捉えるもの | 既定の重み |
|--------|------------------|---------------:|
| **セマンティック**(dense) | 意味; 多言語 (50+ 言語) | `1.0` |
| **BM25**(キーワード) | 正確な用語、コード、名前 | `1.0` |
| **エンティティリンキング** | あなたの `[[ウィキリンク]]`、`#タグ`、見出し、タイトル — キュレーションされたグラフ | `1.5` |
| **FSRS 新近性** | あなたが今使っている / 忘れかけているノートをそっと浮上させる | `±10%` |

- **エンティティマッチング** は、あいまい部分文字列 + 句読点正規化マッチングで自然言語クエリを解決します(韓国語 / CJK フレンドリー)。さらに **ドキュメント単位の多様性キャップ(per-document diversity cap)** により、大きなノート 1 つが上位結果を埋め尽くすのを防ぎます。
- **新近性** は単なるファイル更新時刻(mtime)ではなく、減衰エンジンと同じ FSRS 記憶モデルを再利用します — 忘れかけているノートは再浮上し、習得済みの古い定番ノートが古いというだけで埋もれることはありません。
- **アダプティブ再ランキング**(長時間稼働する MCP サーバー)は、現在のセッション文脈(最近のタグ / パス)でさらに結果を補正します。
- すべての重みはボールトごと、または環境変数で **チューニング可能** です — [設定](#設定) を参照。

---

## MCP 連携 (21ツール)

```bash
stellavault setup            # 1コマンド → Claude Code, Claude Desktop, Cursor, Windsurf, VS Code
# または Claude Code のみ:
claude mcp add stellavault -- stellavault serve
```

Claude があなたのボールトを直接、検索・質問・ドラフト作成・点検・分析できます。検索はハイブリッドパイプライン全体を実行します — セマンティック + BM25 + エンティティリンキングに対する **重み付き RRF**、加えて **FSRS 新近性** とセッション適応型の再ランキング(詳細は [検索とランキング](#検索とランキング))。

| ツール | 機能 |
|------|-------------|
| `search` | 重み付き RRF (セマンティック + BM25 + エンティティ) + FSRS 新近性 + アダプティブ再ランキング |
| `ask` | ボールト根拠の Q&A |
| `generate-draft` | あなたの知識から AI がドラフトを作成 |
| `get-decay-status` | 記憶減衰レポート (FSRS) |
| `detect-gaps` | 知識ギャップ分析 |
| `create-knowledge-node` | AI がウィキ品質のノートを作成 |
| `federated-search` | 複数ボールトをまたぐ P2P 検索 |
| + 他 14 個 | ドキュメント、トピック、決定、スナップショット、エクスポート |

---

## 3D ビジュアライゼーション

- クラスタ色分けされたニューラルグラフ (React Three Fiber)
- コンステレーション(星座)ビュー (MST スターパターン)
- ヒートマップオーバーレイ + タイムラインスライダー + 減衰オーバーレイ
- マルチバースビュー — P2P ネットワーク上で一つの宇宙になったあなたのボールト
- ダーク/ライトテーマ

<table>
  <tr>
    <td width="50%"><img src="images/screenshots/graph-heatmap.png" alt="ヒートマップオーバーレイ" /><br/><sub><b>ヒートマップ</b> — クラスタ間の接続密度</sub></td>
    <td width="50%"><img src="images/screenshots/graph-timeline.png" alt="タイムラインスライダー" /><br/><sub><b>タイムライン</b> — ボールトが育つ様子を時系列で</sub></td>
  </tr>
  <tr>
    <td><img src="images/screenshots/search-active.png" alt="セマンティック検索ハイライト" /><br/><sub><b>検索</b> — グラフ内でセマンティックマッチをハイライト</sub></td>
    <td><img src="images/screenshots/multiverse-view.png" alt="マルチバース P2P ビュー" /><br/><sub><b>マルチバース</b> — 軌道を回る宇宙となった連合ボールト</sub></td>
  </tr>
</table>

---

## 今すぐ試す (デモボールト)

```bash
npx stellavault index --vault ./examples/demo-vault   # サンプルノート 10 件を索引化
npx stellavault search "vector database"               # セマンティック検索
npx stellavault graph                                  # 3D グラフの可視化
```

デモボールトには Vector Database、Knowledge Graph、Spaced Repetition、RAG、MCP など、相互にリンクしたノートが含まれており、すべての機能をすぐに体験できます。

---

## スタートガイド

### デスクトップアプリ

1. **ダウンロード** → 解凍 → 実行
2. 初回起動時にノートフォルダの選択を求められます
3. ノートがサイドバーに表示されます — クリックして開く
4. `Ctrl+P` で高速ファイル切り替え
5. タイトルバーの ✦ をクリック → AI パネル (セマンティック検索、統計、ドラフト)
6. ◉ をクリック → 3D グラフ

### CLI

```bash
npm install -g stellavault
stellavault init                          # セットアップウィザード
stellavault search "machine learning"     # セマンティック検索
stellavault ingest paper.pdf              # 知識を追加
stellavault graph                         # ブラウザで 3D グラフ
stellavault brief                         # 朝のブリーフィング
stellavault decay                         # 今、何を忘れかけている?
```

### キーボードショートカット (デスクトップ)

| ショートカット | 動作 |
|----------|--------|
| `Ctrl+P` | クイックスイッチャー (あいまいファイル検索) |
| `Ctrl+Shift+P` | コマンドパレット (全アクション) |
| `Ctrl+S` | 現在のノートを保存 |
| `Ctrl+\` | 分割ビューの切り替え |
| `Ctrl+B` | 太字 |
| `Ctrl+I` | 斜体 |
| `Ctrl+U` | 下線 |
| `Ctrl+E` | インラインコード |
| `/` | スラッシュコマンド (行頭で) |
| `[[` | ウィキリンクのオートコンプリート |

### クイックリファレンス

| 動作 | デスクトップ | CLI |
|--------|---------|-----|
| ノート検索 | Ctrl+P または AI パネル | `stellavault search "query"` |
| ノート追加 | + Note ボタン または ドラッグ＆ドロップ | `stellavault ingest "text"` |
| 3D グラフ表示 | ◉ ボタン | `stellavault graph` |
| 記憶減衰 | AI パネル → Memory | `stellavault decay` |
| ドラフト生成 | AI パネル → Draft | `stellavault draft "topic"` |
| ヘルスチェック | AI パネル → Stats | `stellavault lint` |

---

## 設定

Stellavault は `./.stellavault.json`(または `~/.stellavault.json`)を読み込みます。検索ランキングは完全にチューニング可能で、妥当な既定値がそのまま機能します:

```jsonc
{
  "search": {
    "rrfK": 60,
    "weights": { "semantic": 1.0, "bm25": 1.0, "entity": 1.5 },
    "recencyWeight": 0.2,                          // FSRS 新近性の強さ; 0 = オフ
    "entityAliases": { "k8s": ["kubernetes"] }     // 同義語 / 言語横断グループ (完全一致のみ)
  }
}
```

環境変数は設定を上書きします (ガード付きでパース):

| 環境変数 | 効果 |
|---------|--------|
| `STELLAVAULT_W_SEMANTIC` / `_BM25` / `_ENTITY` | シグナルごとの RRF 重み (例: `STELLAVAULT_W_ENTITY=2.0` でエンティティを積極的に浮上) |
| `STELLAVAULT_RECENCY_WEIGHT` | 新近性の強さ `0`–`1` (`0` で無効) |
| `STELLAVAULT_DB_PATH` | 索引 DB の場所を上書き |
| `STELLAVAULT_WATCH` | `serve` 実行中の自動再索引ファイルウォッチャーを無効化するには `0` |

> 注: 言語横断のリコール(例: 韓国語クエリで英語ノートを見つける)は多言語埋め込みモデルが自動で処理します — `entityAliases` は、キュレーションされたエンティティグラフ(タグ / ウィキリンク)と略語に対する任意の精度ブーストです。

---

## パフォーマンス

合成ボールトでテスト — 一般的な用途ではすべての操作が 1 秒未満:

| 操作 | 100 ドキュメント | 500 ドキュメント | 1000 ドキュメント |
|-----------|----------|----------|-----------|
| ストア初期化 | 15ms | 15ms | 16ms |
| 一括 upsert | 12ms | 102ms | ~200ms |
| 検索 (BM25) | <1ms | <1ms | <1ms |
| 全ドキュメント取得 | <1ms | 2ms | ~4ms |
| 124K 内積演算 | — | 36ms | — |

自分でベンチマークを実行:

```bash
node tests/stress.mjs 500     # 合成ドキュメント 500 件でテスト
```

主な最適化:
- **HNSW グラフ構築** — 200+ ドキュメントで sqlite-vec KNN (O(n·K·log n) vs O(n²))
- 事前正規化ベクトル: コサイン類似度 → 単一の内積
- バッチ埋め込みロード (バッチあたり 500、RAM オーバーフローを防止)
- 小規模ボールト(< 200 ドキュメント)は上三角ブルートフォース
- 型付き配列による O(n) K-Means セントロイド更新

---

## 技術スタック

| レイヤー | 技術 |
|-------|------|
| デスクトップ | Electron + React + TipTap (15 拡張) + Zustand |
| ランタイム | Node.js 20+ (ESM, TypeScript) |
| ベクトルストア | SQLite-vec (ローカル、設定不要) |
| 埋め込み | MiniLM-L12-v2 (ローカル、50+ 言語、バッチ処理) |
| 検索 | 重み付き RRF (セマンティック + BM25 + エンティティ) + FSRS 新近性 |
| 数式 | KaTeX (インライン + ディスプレイ) |
| コード | lowlight / highlight.js (40+ 言語) |
| 3D | React Three Fiber + Three.js |
| AI | MCP (21 ツール) + Anthropic SDK |
| P2P | Hyperswarm (任意、差分プライバシー) |
| CI | GitHub Actions (Node 20 + 22) |

---

## セキュリティ

- **ローカルファースト** — `--ai` を使わない限りデータが端末を離れません
- **ボールトファイルは決して変更しない** — SQLite に索引化するだけで、元ファイルはそのまま
- **Electron サンドボックス有効** — レンダラーは縮小された OS 権限で実行
- **IPC パス検証** — すべてのファイル操作はボールトルート内に留まる
- **API 認証トークン** — セッションごと、ヘッダー専用(`X-Stellavault-Token`)。トークンのエンドポイントは同一オリジン(same-origin)のみ
- **CORS 許可リスト** — 既定は `localhost` / `127.0.0.1` のみ; MCP HTTP トランスポートはオプトイン
- **SSRF 対策** — URL 取り込み時にプライベート IP をブロック
- **E2E 暗号化** — クラウド同期に AES-256-GCM

### フェデレーション (実験的、既定でオフ)

P2P セマンティック検索は **オプトインの実験的機能** として提供されます。既定のインストールではどの swarm にも参加せず、データを共有することはありません。

明示的に有効化:

```bash
# PowerShell
$env:STELLAVAULT_FEDERATION_EXPERIMENTAL = "1"

# bash / zsh
export STELLAVAULT_FEDERATION_EXPERIMENTAL=1

stellavault federate join
```

有効化すると、フェデレーションは Ed25519 アイデンティティと署名付きエンベロープ、相互チャレンジ・レスポンスのハンドシェイク、エンベロープごとのリプレイ用ノンス、ハンドシェイクタイムアウト、ピアごとのレート制限、そして受信専用の共有既定値(`myNodeLevel=0`)を使用します。実際にタイトル/スニペットをピアと共有するには、フェデレーションプロンプトで `set-level 1+` を実行してください。

> **アップグレード注記 (v0.7.4)** — フェデレーションのワイヤーフォーマットが v2.0 → v2.1(エンベロープ単位のノンス)に上がりました。v0.7.3 のノードとは互換性がありません。既存の `~/.stellavault/federation/sharing.json` はより安全な既定値へ自動ダウングレード **されない** ため、以前オプトインしていた場合は `myNodeLevel` を見直してください。

詳細は [SECURITY.md](SECURITY.md) を参照してください。

## トラブルシューティング

```bash
stellavault doctor    # 設定、ボールト、DB、モデル、Node バージョンを確認
```

よくある問題:
- **"Command not found"** → `npm i -g stellavault@latest`
- **"API server not found"** → `npx stellavault graph`
- **空のグラフ** → `stellavault index`
- **初回起動が遅い** → AI モデル ~30MB を初回のみダウンロード

## コントリビュート

Issue と Pull Request を歓迎します。はじめ方は [CONTRIBUTING.md](CONTRIBUTING.md) を、脆弱性の報告は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

MIT — 全ソースコードを監査(audit)できます。

## リンク

- **[⬇ デスクトップアプリをダウンロード](https://github.com/Evanciel/stellavault/releases/tag/desktop-v0.1.0)**
- [ランディングページ](https://evanciel.github.io/stellavault/)
- [Obsidian プラグイン](https://github.com/Evanciel/stellavault-obsidian)
- [npm](https://www.npmjs.com/package/stellavault)
- [GitHub リリース](https://github.com/Evanciel/stellavault/releases)
- [セキュリティポリシー](SECURITY.md)
