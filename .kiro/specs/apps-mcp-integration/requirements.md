# Requirements Document

## Introduction
Mask-Cut モノレポの `apps/` 配下に MCP (Model Context Protocol) アプリケーションを新設し、既存クライアントと同じ共有ライブラリを介してマスキング機能を公開できるようにする。pnpm ワークスペースや監査ログの慣習を踏襲しつつ、AI チャットがリクエストを処理する前にローカル LLM でオフラインマスキングとユーザー承認フローを完結させることで、機密テキストが外部へ送信されない統合ポイントを整備する。

## Requirements

### Requirement 1: MCPアプリ基盤構築
**Objective:** As a プラットフォームメンテナー, I want 一貫した MCP アプリの足場を用意し、so that 既存クライアントと同じ方法でビルドと配布を制御できる。

#### Acceptance Criteria
1. The モノレポ構成 shall register `apps/mcp` を pnpm ワークスペースターゲットとして追加し、package.json・tsconfig・lint/build/test スクリプトを他アプリと同じ方針で提供する。
2. When `pnpm install` is executed at the repository root, the MCPアプリケーション shall 解決すべき依存関係をすべてワークスペースリンク経由で取得し、手動リンクやグローバルインストールを要求しない。
3. Where 共有マスキングロジックが必要な場合, the MCPアプリケーション shall `@mask-cut/text-llm-core` のパスエイリアスを利用してコードを再利用する。
4. If `pnpm --filter apps/mcp build` encounters compile errors, the MCPアプリケーション shall 非ゼロ終了コードと該当ファイル・行番号を含む診断を出力してビルドを失敗させる。

### Requirement 2: ローカルLLMマスキングサービス提供
**Objective:** As a MCP クライアント開発者, I want MCP 経由でローカル LLM を使ったマスキング API を呼び出し, so that ネットワークに依存せず固有名詞を安全に処理できる。

#### Acceptance Criteria
1. When an MCP client submits a masking request with plaintext input and masking options, the MCPアプリケーション shall `@mask-cut/text-llm-core` をローカル推論バックエンドとともに実行し、マスク済みテキストとマスク数・トークン・レイテンシーなどのメタデータをレスポンスに含める。
2. While a masking request is processing, the MCPアプリケーション shall セッション単位でジョブロックを維持し、マスキングが完了するまで外部 LLM エンドポイントへのネットワーク送信を禁止する。
3. If the ローカル LLM 実行や基盤ユースケースがエラーを返す, the MCPアプリケーション shall 既存の `E_NETWORK`/`E_TIMEOUT`/`E_MASK_FAILED` エラーコードへ正規化してクライアントへ返す。
4. When an MCP client queries job status, the MCPアプリケーション shall `masking:status` スキーマ (jobId/state/locked/errorCode) と整合する進捗シグナルを公開する。

### Requirement 3: 設定・監査・セキュリティ統制
**Objective:** As a 運用オーナー, I want MCP アプリの設定と監査ログを既存規約に合わせ, so that シークレット保護と可観測性を一貫させられる。

#### Acceptance Criteria
1. The MCPアプリケーション shall `MASK_CUT_ENDPOINT_URL`, `MASK_CUT_MODEL_NAME`, `MASK_CUT_API_KEY`, `MASK_CUT_TIMEOUT_MS`, `MASK_CUT_VAULT_ID` を既定値として読み取り、欠落時には設定が上書きされるまで接続を受け付けない。
2. When required configuration values are missing or invalid, the MCPアプリケーション shall 起動を拒否し、欠落キー名と期待形式を含む検証エラーを表示する。
3. While the MCPアプリケーション is running, the MCPアプリケーション shall API キーや未加工テキストをすべてのログとテレメトリからマスクし、保存済みメッセージに秘匿情報が残らないようにする。
4. If a masking job completes successfully, the MCPアプリケーション shall タイムスタンプ・プロファイル識別子・入力/出力バイト数を含む監査エントリを設定済みログシンクへ追記する。
5. Where ローカル LLM モデルファイルのパスやランタイム設定が定義される, the MCPアプリケーション shall バリデーション済みのローカルディレクトリのみを許可し、意図しないリモート推論を構成できないようにする。

### Requirement 4: AIチャット連携とユーザー承認
**Objective:** As a ユーザー, I want AI チャットへ送る前にマスク結果を確認・承認したい, so that 不必要な情報が外部チャットに流出しない。

#### Acceptance Criteria
1. When the AI チャット連携がチャット本文を送信しようとする, the MCPアプリケーション shall 先にローカル LLM マスキングを完了させ、マスク済みプレビューとメタデータをユーザーへ提示する。
2. While the ユーザーの明示承認が得られていない, the MCPアプリケーション shall チャット AI への転送を保留し、待機状態を `masking:status` に反映する。
3. If the ユーザーがマスク結果を拒否または修正したいと入力する, the MCPアプリケーション shall マスク済みテキストを破棄し、元テキストの編集または再マスキングを許可する。
4. When the ユーザーがマスク結果を承認する, the MCPアプリケーション shall 承認されたテキストのみをチャット AI へ送信し、承認時刻とジョブ ID を監査ログに追記する。
