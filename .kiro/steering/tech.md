# Technology Stack

_updated_at: 2025-11-08_

## Architecture

モノレポ (pnpm) 構成で、共通ロジックを `packages/` に集約し、各クライアントアプリ (`apps/`) から共有する構造。コアパッケージはヘッドレスな TypeScript ライブラリとして実装し、ブラウザ・デスクトップ・CLI から共通 API を利用できるようにしている。

### CLI ランタイム層

- CLI は Node.js 18+ をターゲットに `type: module` で記述し、`tsup` で ESM バンドル + shebang 付きの単一 `dist/index.js` に圧縮している。
- エントリポイントでは `CommandRouter` / `CliApplication` / `ProcessIO` を組み合わせ、グローバルフラグ解析 → コマンド毎の引数解析 → 共通エラーハンドリング → 監査ログ出力までを一気通貫で処理する。
- LLM 呼び出しは `OpenAICompatibleClient` を `llmFactory` から DI し、`maskSensitiveInfo` などコアライブラリのユースケースに委譲することで CLI 層を純粋な I/O + orchestration に留めている。

## Core Technologies

- **Language**: TypeScript 5.x (strict モード)
- **Framework**: フレームワーク非依存のヘッドレスライブラリ (将来的に各クライアントで UI フレームワークを組み合わせ)
- **Runtime**: Node.js / Web runtime を想定 (Fetch API ベース)
- **CLI ツールチェーン**: `tsup` + `tsx` + Node.js Test Runner (`node --loader ts-node/esm --test`) でトランスパイル / dev 実行 / テストを回す。`tsconfig.base.json` では `@mask-cut/text-llm-core` へのパスエイリアスを定義し、CLI 側でもソースを直接参照できる。

## Key Libraries

- `Fetch API (globalThis.fetch)`: Node.js 18+ / ブラウザで共通の Fetch 実装を利用し、OpenAI 互換 API 呼び出しを行う
- `tsup`: CJS と ESM を同時に生成するビルドツール (型定義も出力)
- `keytar`: CLI で API キーを OS 共通の資格情報ストアに保存する際に動的 import される optional dependency
- `ts-node` / `tsx`: ESM ベースの開発サーバーと Node 標準テストを TypeScript ソースのまま実行するユーティリティ

## Development Standards

### Type Safety
- TypeScript strict 設定を必須 (`strict: true`, `noEmit` lint)
- ドメイン型 (`MaskingOptions`, `MaskingResult`) をパッケージ公開 API として明示

### Code Quality
- `pnpm run lint` で型チェックを実施
- `pnpm run build` で CJS/ESM/型定義を生成、sourcemap も提供

### Testing
- まだ本格的なテストスイートは未整備 (`test` はプレースホルダ)
- マスキングロジックは LLM 依存のため、将来的にモックベースの回帰テストを追加予定
- CLI では Node.js Test Runner (`node --loader ts-node/esm --test`) を採用し、`*.test.ts` を隣接配置して I/O 抽象 (InputResolver/AuditLogger など) をスタブ可能にしている。

### CLI レジリエンス
- グローバル引数の手動パーシングで依存を最小化しつつ、未知オプション/不足値を `CliUsageError` 経由で `E_USAGE` に束ねる。
- コマンド実行結果は `OutputFormatter` が JSON / text / dry-run / error を統一的に描画し、`AuditLogger` が JSON Lines 形式でオプションのログファイルへ追記する。
- ネットワーク・タイムアウト・LLM 応答不備は `CliNetworkError`/`CliTimeoutError`/`MaskingOperationError` に正規化してエラードメイン毎の exit code を固定している。

## Development Environment

### Required Tools
- Node.js 18+ (Fetch API をサポート)
- pnpm 8.x (モノレポ管理)

### Common Commands
```bash
# 依存関係インストール
pnpm install

# コアライブラリのビルド
pnpm --filter @mask-cut/text-llm-core build

# 型チェック (モノレポ全体)
pnpm lint

# CLI 開発用ホットリロード
pnpm --filter @mask-cut/cli dev

# CLI の単体テスト
pnpm --filter @mask-cut/cli test
```

## Key Technical Decisions

- LLM 呼び出しは `LLMClient` インターフェースで抽象化し、OpenAI 互換クライアントをリファレンス実装とする。
- マスキングオプションは拡張しやすいユニオン型で管理し、デフォルトは日本語ドメイン (マスクトークンや回答形式も日本語基準)。
- `packages/` で生成した型定義をクライアントアプリに輸出し、アプリ側は独自の LLM 実装を差し替え可能にしている。
- CLI の設定ファイルは OS ごとの既定フォルダに JSON で保存し、API キーは `vaultKeyId` + `keytar` に委譲することで平文保存を避ける。
- `ExecutionTelemetry` を各コマンドで生成し、プロファイル名・入力バイト数・Masked バイト数を JSON Lines として残す。`logFile` はプロファイル定義または `--log-file` で注入する。
- path alias (`@mask-cut/text-llm-core`) を `tsconfig.base.json` で宣言し、CLI からはワークスペースソースを直接 import→`tsup` の `noExternal` で同梱する。

---
_主要な技術と意思決定のみを記録し、依存一覧にはしない_
