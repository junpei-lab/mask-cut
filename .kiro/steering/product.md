# Product Overview

_updated_at: 2025-11-08_

Mask-Cut は、LLM との連携前にテキストから人名や組織名などの固有名詞を安全にマスキングするための開発者向けツール群です。複数のクライアント (CLI, Chrome 拡張, VS Code 拡張, Electron アプリ) から同じコアロジックを呼び出せるよう設計されています。

## Core Capabilities

1. 固有名詞マスキング: LLM を利用して人名・社名・組織名を自動マスキング。
2. 形式維持: 原文の構成や形式を保ったままマスクトークンのみを置換。
3. マルチクライアント共有: 共通ライブラリ (@mask-cut/text-llm-core) を複数アプリで再利用。
4. LLM プロバイダー抽象化: OpenAI 互換 API へ統一的にアクセスできるクライアントを提供。

## Target Use Cases

- チャットログや文章を LLM に渡す前の個人情報マスキング
- コールセンター記録や議事録など、固有名詞を含むテキストの匿名化
- ブラウザ拡張・デスクトップアプリでの一括マスキングワークフロー

## Value Proposition

- マスクスタイルや言語設定を切り替えられる柔軟なオプション
- LLM 依存の動作詳細をライブラリ内部に閉じ込め、クライアント実装を軽量化
- コアロジックを単一パッケージに集約し、機能拡張や品質保証を集中させやすいアーキテクチャ

## リファレンス CLI ワークフロー

- **接続プロファイル + 監査ログ**: `config init/list/use` で OS 標準パス (`%APPDATA%` / `$XDG_CONFIG_HOME`) の `config.json` を育て、API キーは `keytar` 経由で vault に退避。プロファイルには `logFile` を紐づけ、各コマンド実行から JSON Lines 監査ログを追記する。
- **入力多態性**: `InputResolver` が inline / ファイル / stdin を同一 `TextSource` で扱い、後段が入力経路を意識せずに済む。stdin 無入力時には早期エラーにマップする。
- **運用フレンドリーな実行モード**: `--dry-run` は LLM 呼び出しをスキップした構成確認専用の `dry-run` 出力を返し、`--format json` はマスク結果 + metrics を API へ転送しやすい構造化データで提供する。
- **フェイルセーフ CLI 体験**: `CommandRouter` と `ErrorDomainMapper` でコマンド/エラーを集中管理し、使用ミスは `E_USAGE`, ネットワーク系は `E_NETWORK/E_TIMEOUT`, LLM 応答不備は `E_MASK_FAILED` へ収束させる。グローバルオプション (`--quiet`, `--log-file` 等) は `CliApplication` で先に解決し、各コマンドはドメインロジックに集中できる。
- **コアライブラリ再利用パス**: `mask` コマンドは `@mask-cut/text-llm-core` の `maskSensitiveInfo` にオプションごとの引数を橋渡しし、CLI 側では I/O と実行体験だけを責務とする。ほかのクライアント (Chrome 拡張等) もこの接続面を共有する想定。

---
_フォーカスはパターンとプロダクトの方向性であり、機能一覧ではありません_
