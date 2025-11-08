# Project Structure

_updated_at: 2025-11-08_

## Organization Philosophy

共通ロジックは `packages/` に、UI やプラットフォーム固有処理は `apps/` に配置する「コアライブラリ + 薄いクライアント」構成。ライブラリ内はドメインごとにディレクトリを分け、公開 API は `src/index.ts` から集約エクスポートする。

## Directory Patterns

### Core Packages
**Location**: `/packages/*/src/`
**Purpose**: LLM 呼び出しやマスキングロジックなど、プラットフォーム非依存コードを実装
**Example**: `packages/text-llm-core/src/usecases/masking.ts` でマスキングユースケースを提供

### Client Apps
**Location**: `/apps/`
**Purpose**: Chrome 拡張、CLI、Electron、VSCode など各プラットフォーム向けシェルを配置 (現状はブートストラップ状態)
**Example**: `apps/chrome-extension/` などがコアライブラリを参照して UI/UX を提供する予定

### Domain Modules
**Location**: `/packages/text-llm-core/src/{llm,usecases}`
**Purpose**: LLM アクセス層 (`llm/`) とアプリケーションユースケース (`usecases/`) を分離し、責務を明確化
**Example**: `llm/openaiCompatibleClient.ts` が外部 API をラップし、`usecases/masking.ts` がビジネスロジックを表現

### CLI (`apps/cli/src/`)
**Command Layer**: `commands/` にコマンドごとの descriptor + handler を配置し、`CommandRouter` が `Map` ベースで登録/dispatch。各 handler は CLI 固有の引数パーサー (例: `parseMaskCommandArgs`) を持ち、`CommandResult` を返す。

**Config Layer**: `config/` 配下で `ConfigStore` (JSON ファイル I/O)・`ConfigService` (profiles / defaults / vault lookup)・`credentialVault` (keytar or in-memory) を分離。`resolveConfigFilePath` は OS ごとのホームディレクトリ規約をカプセル化する。

**Infrastructure Utilities**: ルート直下に `cliApplication.ts` (global options, telemetry, audit logging), `commandRouter.ts`, `inputResolver.ts`, `outputFormatter.ts`, `errorDomainMapper.ts`, `processIo.ts`, `types.ts` を配置し、CLI の I/O・エラー・テレメトリを横断的に扱う。

**Tests**: 各ユーティリティ/command と同じディレクトリに `*.test.ts` を隣接させ、Node Test Runner + `ts-node` ローダーで直接実行できるようにしている。

## Naming Conventions

- **Files**: キャメルケース + ドメイン名 (`maskingPrompts.ts`, `openaiCompatibleClient.ts`)
- **クラス**: PascalCase (`OpenAICompatibleClient`)
- **関数 / 変数**: camelCase (`maskSensitiveInfo`, `buildMaskToken`)
- **型エイリアス / インターフェース**: PascalCase (`MaskingOptions`, `LLMRequest`)

## Import Organization

```typescript
// 相対パスでドメイン間依存を明示
import type { LLMClient } from '../llm/types';
import { MASKING_SYSTEM_PROMPT } from './maskingPrompts';
```

**Path Aliases**:
- `@mask-cut/text-llm-core` → `packages/text-llm-core/src/index.ts` を `tsconfig.base.json` で解決。CLI などアプリ側はこの別名でコア API を参照しつつ、ビルド時は `tsup` の `noExternal` で同梱する。
- それ以外の境界は相対 import を維持し、階層が深くなり過ぎないようディレクトリをドメイン単位に分割する。

## Code Organization Principles

- `src/index.ts` で公開 API を再エクスポートし、クライアント側はパッケージ名から参照。
- LLM アクセス層とドメインユースケースを分離し、副作用のある処理はクライアント (`LLMClient`) に委譲。
- マスキングルールは日本語ドメイン前提で記述し、オプション拡張に備えて enum/union 型で制約。
- `CliApplication` → `CommandRouter` → command handler → `maskSensitiveInfo` という直線的な依存方向を守り、CLI でも「上位が下位を DI する」原則を徹底する。
- `InputResolver` → `CommandResult.telemetry` → `AuditLogger` の流れで入力バイト数/Masked バイト数を算出し、オプションの `logFile` (プロファイル設定または `--log-file`) に JSON Lines を追記する。

## Configuration Footprint

- CLI の `config.json` は初回起動時に `ConfigStore.ensureInitialized()` が自動生成し、パスは `resolveConfigFilePath` が `%APPDATA%/MaskCut/config.json` または `$XDG_CONFIG_HOME/mask-cut/config.json` (未設定なら `~/.config`) を返す。
- プロファイルごとに `vaultKeyId` を保持でき、API キーは `credentialVault` (デフォルトは `keytar`) で保存/取得する。プロファイルの `logFile` は監査ログ出力先として `CommandResult.logFile` に流用される。

---
_パターンを記述し、ディレクトリ全体の羅列は避ける_
