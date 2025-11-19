# Implementation Plan

- [x] 1. MCP アプリ基盤を scaffold し、pnpm ワークスペースへ統合する
- [x] 1.1 package/lint/test setup を整備し、既存ルールへの準拠を検証する
  - `apps/mcp/package.json`, tsconfig, tsup/tsx スクリプトを CLI/Electron と同水準で構成し、`pnpm --filter apps/mcp build|lint|test` が通る環境を作る。
  - `pnpm-workspace.yaml` にエントリを追加し、`pnpm install` で依存がリンクされることを確認する。
  - `MASK_CUT_*` 既定値を読み込むエントリポイント雛形を作成し、空設定での起動失敗メッセージを追加する。
  - _Requirements: 1.1, 1.2, 1.4, 3.1, 3.2_
- [x] 1.2 MCP server bootstrap と tool/resource の骨格を実装する
  - `@modelcontextprotocol/sdk` を利用して `mask_text` ツール、`masking:status` リソース、ヘルスチェックを登録し、`MaskingWorkflow` へ委譲するフックを用意する。
  - CLI の `ErrorDomainMapper` を参考に MCP 応答のエラー正規化 (`E_USAGE/E_NETWORK/E_TIMEOUT/E_MASK_FAILED/E_INTERNAL`) を組み込む。
  - 起動時に ConfigurationService から設定を読み込み、`ApprovalTransport` への依存を解決する DI を整える。
  - _Requirements: 1.3, 2.4, 4.1, 4.2_

- [x] 2. 設定ストアとローカルモデル検証レイヤーを実装する
- [x] 2.1 ConfigurationService を実装し、環境変数 seed と設定ファイルのバリデーションを提供する
  - CLI/Electron の設定パターンを踏襲し、`apps/mcp/config/settings.json` と SecureStoreAdapter を用いて endpoint label, timeout, logFile, local model 設定を保持する。
  - `MASK_CUT_ENDPOINT_URL` などの既定値を seed としてロードし、値が欠落/不正な場合は具体的な検証エラーを返す。
  - 保存時に API キーを vault へ書き込み、設定ファイルと vaultKeyId の整合性を維持する。
  - _Requirements: 1.1, 3.1, 3.2_
- [x] 2.2 LocalModelRegistry/LocalModelConfig を実装し、オフライン実行を保証する
  - engine (ollama/llamaCpp/custom) ごとの設定スキーマと存在チェックを実装し、`assertOfflineMode` で HTTP/HTTPS や未許可ディレクトリを拒否する。
  - モデルパス/バイナリのアクセス権限チェック、Ollama のローカルホスト固定、custom script のホワイトリストを組み込む。
  - 設定不備の場合は MCP 起動を停止し、詳細な原因を ConfigurationService 経由で報告する。
  - _Requirements: 2.2, 3.5_

- [x] 3. ローカル LLM ゲートウェイとマスキングワークフローを構築する
- [x] 3.1 LocalLlmGateway を実装し、LLMClient ポートをローカルエンジンに接続する
  - LocalModelRegistry の設定を読み込み、Ollama HTTP 呼び出し・llama.cpp プロセス実行・custom script など複数 backend を選択できるようにする。
  - `maskSensitiveInfo` が期待する `LLMClient` 契約に合わせて `generate` を実装し、timeout・エラー正規化・レスポンス検証を行う。
  - warmup ルーチンを用意し、アプリ起動時にモデルロード/health チェックを済ませる。
  - _Requirements: 2.1, 2.2, 2.3_
- [x] 3.2 MaskingWorkflow を実装し、ジョブキュー/ステータス配信/承認連携を統括する
  - 既存 `MaskingJobQueue` と `MaskingCache` を再利用し、`startMasking` で jobId 発行・queue 投入・`masking:status` 送出を行う。
  - LocalLlmGateway でマスクを実行し、結果スナップショットを ApprovalController へ渡して承認セッションを開始する。
  - エラー時は Electron の mapError ロジックを参考に、`E_NETWORK/E_TIMEOUT/E_MASK_FAILED/E_USAGE/E_INTERNAL` を返却する。
  - _Requirements: 1.3, 2.1, 2.3, 2.4, 4.1_

- [x] 4. 承認ステートマシンとチャットリレーを実装する
- [x] 4.1 ApprovalController と ApprovalTransport を実装し、ユーザー承認フローを制御する
  - `createSession`/`awaitDecision` を実装し、MCP interactive セッションを使ってプレビュー提示・approve/reject/edit の入力を受け取る。
  - `masking:status` に `state: waiting-approval` を追加し、承認待ちでチャット送信がブロックされていることを通知する。
  - `edit` 決定時は MaskingWorkflow へ再ジョブ投入、`reject` はジョブを失敗させて監査ログへ記録する。
  - _Requirements: 4.1, 4.2, 4.3_
- [x] 4.2 ChatRelayAdapter を実装し、承認済みテキストのみチャット AI へ送信する
  - 承認完了後に `sendApprovedMessage` を呼び出し、`chatMessageId`, `maskedText`, `model`, `endpointLabel` を payload として送る。
  - 送信失敗時は `E_NETWORK/E_TIMEOUT` を返し、AuditTrailWriter へエラーを記録する。
  - 原文や未承認テキストが外部に流れないよう、マスク済みテキスト以外を破棄する。
  - _Requirements: 2.2, 4.4_

- [x] 5. 監査ログと可観測性を強化する
- [x] 5.1 AuditTrailWriter を実装し、ジョブ/承認/転送イベントを JSON Lines に記録する
  - CLI の AuditLogger をラップし、`jobId`, `inputBytes`, `maskedBytes`, `decision`, `approvedAt`, `relayedAt`, `errorCode` を書き出す。
  - ログには原文を含めず、統計情報と決定メタデータのみを保持する。
  - 監査ログ経路を ConfigurationService の logFile 設定または `--log-file` 環境に合わせる。
  - _Requirements: 3.3, 3.4, 4.4_
- [x] 5.2 StatusBroadcaster/health エンドポイントを整備し、処理状況をチャットクライアントへ提供する
  - `masking:status` の snapshot を保持し、新規リスナーが queued→running→waiting→succeeded/failed を追跡できるようにする。
  - `/healthz` (ローカル) を実装し、queue backlog, approval session count, local model readiness を返す。
  - _Requirements: 2.4, 4.2_

- [x] 6. テストと検証
- [x] 6.1 LocalModelRegistry, LocalLlmGateway, ApprovalController のユニットテストを追加する
  - モデルパス検証や offline 判定、Ollama/llama.cpp backend の generate モック、承認ステートマシンの approve/reject/edit フローを検証する。
  - _Requirements: 2.2, 2.3, 4.1, 4.2, 4.3_
- [x] 6.2 マスキング〜承認〜チャット転送の統合テストを実装する
  - MCP tool 呼び出しからローカル LLM 実行、承認、ChatRelayAdapter の送信、AuditTrailWriter への記録までを e2e で確認する。
  - タイムアウト/拒否/再編集など主要な分岐もカバーする。
  - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 4.4_
