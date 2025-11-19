# Research & Design Decisions Template

---
**Purpose**: Capture discovery findings, architectural investigations, and rationale that inform the technical design.

**Usage**:
- Log research activities and outcomes during the discovery phase.
- Document design decision trade-offs that are too detailed for `design.md`.
- Provide references and evidence for future audits or reuse.
---

## Summary
- **Feature**: apps-mcp-integration
- **Discovery Scope**: Complex Integration
- **Key Findings**:
  - 既存 Electron/CLI クライアントは `MaskingJobQueue` + `maskSensitiveInfo` を中核に据えており、MCP でも同じステート/エラーコードを再利用することで可観測性とコアロジックの一貫性を保てる。
  - ローカル LLM 実行は `LLMClient` ポートを実装したアダプター (`LocalLlmClient`) を用意すれば `@mask-cut/text-llm-core` のユースケースをそのまま使える。Ollama や llama.cpp の HTTP/CLI を選択制でラップする構成が現実的。
  - ユーザー承認フローは Model Context Protocol (MCP) のツール呼び出しライフサイクルにフックし、`masking:status` のステートと監査ログ (`AuditLogger`) を同期させることでチャット AI へ送るテキストを逐次 gating できる。

## Research Log

### Requirements 分解
- **Context**: EARS 要件を技術作業に落とし込む必要がある。
- **Sources Consulted**: `.kiro/specs/apps-mcp-integration/requirements.md`
- **Findings**:
  - Requirement 1 は pnpm ワークスペース登録、TypeScript ビルド、Lint/Test スクリプトを既存アプリと整合させることが必須。
  - Requirement 2,4 で「ローカル LLM」「ユーザー承認」「外部チャット前のガード」が求められ、ネットワーク越しの LLM 呼び出しは禁止。
  - Requirement 3 で `MASK_CUT_*` 系環境変数、監査ログ、vault で守られたシークレット、ローカルモデルパス検証が必須。
- **Implications**: MCP アプリは設定/監査レイヤーを内包し、既存 CLI/Electron のパターンを継承する必要がある。

### 既存クライアントの構造調査
- **Context**: Job Queue と設定/監査の実装パターンを把握したい。
- **Sources Consulted**: `apps/electron-app/src/main/masking/*.ts`, `apps/cli/src/*`, `packages/text-llm-core`
- **Findings**:
  - `MaskingService` + `MaskingJobQueue` がジョブ状態 (`masking:status`) を発行し、`MaskingCache` が最新入力/結果を保持。
  - `SettingsService` は環境変数シード + `SecureStoreAdapter` で API キーを keytar へ保存。
  - CLI 側 `ConfigService` + `AuditLogger` が JSON Lines 監査ログを記録し、`ErrorDomainMapper` で `E_USAGE/E_NETWORK/E_TIMEOUT/E_MASK_FAILED` へ正規化。
- **Implications**: MCP アプリもこの組み合わせを流用し、`LocalLlmClient` を `llmFactory` に差し込む構造が適切。

### MCP + ローカル LLM オフライン実行
- **Context**: Model Context Protocol をホストする Node アプリでローカル LLM を使う手段を検討。
- **Sources Consulted**: モデル Context Protocol の一般仕様（既知の `@modelcontextprotocol/sdk` の API）、社内知見、Ollama/llama.cpp の一般仕様。
- **Findings**:
  - MCP サーバーはツール (`tools/mask`) やリソース (`resources/maskedText`) を公開し、チャットクライアントはコマンドを実行して結果を受け取る。
  - ローカル LLM としては HTTP ベース（Ollama `POST /api/generate`）と CLI ベース（`llama.cpp` バイナリ）双方に需要があるため、`LocalLlmBackend` インターフェースで切り替え可能にすべき。
  - オフライン担保には構成検証時に `LocalModelRegistry` がモデルファイル/gguf ディレクトリを存在チェックし、HTTP で外部へフォールバックしない保証が必要。
- **Implications**: MCP アプリは起動時に外部 HTTP 呼び出しを無効化し、ローカル実行の健全性チェックを実装する必要がある。

### 承認フローとチャットブリッジ
- **Context**: 要件 4 のユーザー承認→チャット送信を MCP 内でどう制御するか。
- **Sources Consulted**: 既存 `masking:status` イベント、`apps/cli/src/auditLogger.ts`、MCP の tool call 応答パターン。
- **Findings**:
  - MCP は `interactive` セッションを用いてユーザーから追加入力を得られるため、マスク済みプレビューを表示し、`approve/reject/edit` を提示できる。
  - 承認後のみ `ChatRelay` (新規コンポーネント) が `sendToChatAI` ハンドラーを実行し、それまでは `paused` ステートを `masking:status` に追加してチャット側に伝達する。
  - 監査ログには `jobId`, `userDecision`, `approvedAt`, `sourceChatId` を追記する必要がある。
- **Implications**: MCP アプリは承認専用のステートマシン (`ApprovalController`) を持ち、チャット転送は pluggable adapter（例: OpenAI API, Azure OpenAI）に委譲。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Hexagonal MCP Service | Core masking/approvalをポートで包み、MCP/ローカルLLM/チャット送信をアダプター化 | 依存逆転で `LLMClient` やチャット送信先を差し替えやすい | レイヤーが増え初期コストが高い | 既存 CLI/Electron も似た構造なので整合的 |
| Direct MCP Tool | MCP SDK から直接 `maskSensitiveInfo` + approval を記述 | 実装が簡単で初動が早い | テストしづらく、ローカル LLM/チャットアダプターの切替が困難 | Type safety や将来拡張に不利で却下 |
| Electron Integration | 既存 Electron アプリに MCP モードを追加 | UI コンポーネントを流用できる | Electron に依存した配布となり、headless MCP 需要を満たせない | CLI/サーバー利用を想定するため不適 |

## Design Decisions

### Decision: Hexagonal サービス構造を採用
- **Context**: MCP サーバーはローカル LLM・承認フロー・チャット転送を分離して制御したい。
- **Alternatives Considered**:
  1. MCP SDK に直接ユースケースを書く
  2. Electron 内に MCP モードを作る
- **Selected Approach**: `MaskingWorkflow` (core) + `LocalLlmGateway` / `ApprovalController` / `ChatRelayAdapter` のポート&アダプター構成。
- **Rationale**: 既存 CLI/Electron の依存方向と揃い、LLM 実装や承認 UI を差し替えやすい。
- **Trade-offs**: 初期の抽象化コストが増えるが、テスト容易性と将来のクラウド/オンプレ両対応を得られる。
- **Follow-up**: 実装時に DI コンテナ or simple factory を用意し、ユニットテストで各アダプターをスタブ化。

### Decision: ローカル LLM をバックエンド種別で抽象化
- **Context**: 要件でネットワーク依存禁止。Ollama/llama.cpp など複数選択肢がある。
- **Alternatives Considered**:
  1. Ollama 固定の HTTP クライアント
  2. llama.cpp プロセス埋め込み
- **Selected Approach**: `LocalLlmBackend` インターフェース (engine = `ollama` | `llamaCpp` | `customScript`) を `LocalLlmGateway` が実装。
- **Rationale**: 1 つに固定するとユーザー環境に依存しすぎる。抽象化により engine 追加が簡単になる。
- **Trade-offs**: 設定項目と検証ロジックが増える。
- **Follow-up**: 実装時にバックエンドごとのヘルスチェックを整備。

### Decision: 承認フローを状態マシンとして MCP tool に組み込む
- **Context**: ユーザー承認が得られるまでチャット送信禁止。
- **Alternatives Considered**:
  1. チャットクライアント側に UI を委譲
  2. MCP 側で `interactive` セッション管理
- **Selected Approach**: MCP tool が `approvalSessionId` を生成し、`ApprovalController` が `pending -> approved/rejected -> relayed` を管理。チャットクライアントは sessionId を poll する。
- **Rationale**: 中央集権のほうが監査/ログが簡単で Requirement 4 に適合。
- **Trade-offs**: MCP サーバー側で最低限の UI/入力処理を実装する必要がある。
- **Follow-up**: 実装時に CLI/TUI 表示を `ink` などで整備、または VS Code 拡張への hook。

## Risks & Mitigations
- ローカル LLM 実行が高負荷で遅延する → モデルロードをウォームアップし、`timeoutMs` を設定ファイルで調整できるようにする。
- MCP ユーザー承認 UI の操作性が不足 → `ApprovalController` を抽象化して VSCode/CLI/REST など複数チャネルをサポート。
- 誤設定でリモート LLM を呼び出す危険 → `LocalModelRegistry` が外部 URL を拒否し、検証失敗時は起動を止める。

## References
- `apps/electron-app/src/main/masking/maskingService.ts` — 既存マスキングワーカーとエラー処理の参照実装。
- `apps/cli/src/auditLogger.ts` — 監査ログフォーマットと JSON Lines 記録方法。
- `packages/text-llm-core/src/usecases/masking.ts` — `LLMClient` ポートとマスキングユースケース。
