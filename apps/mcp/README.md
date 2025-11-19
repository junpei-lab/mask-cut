# @mask-cut/mcp

Mask-Cut MCP は、@mask-cut/text-llm-core のマスキングワークフローを Model Context Protocol (MCP) で再利用できるようにしたローカルサーバーです。ローカル LLM やカスタム承認フローを経由してチーム既定のマスキングを強制し、Claude Desktop や Codex CLI など MCP 対応クライアントから安全にテキストを送信できます。

## 提供機能
- **`mask_text` ツール**: `inputText` と任意の `options` を受け取り、非同期ジョブとしてマスキングを実行。レスポンスには `jobId` / `approvalSessionId` / `statusResource` が含まれます。
- **`mask-cut://masking/status` リソース**: 直近 50 件のジョブスナップショットを JSON で返却。`state` は `queued | running | waiting-approval | succeeded | failed` を取り、`maskedText` / `errorCode` などのメタも確認できます。
- **`mask-cut://healthz` リソース**: 現在のエンドポイント設定・タイムアウト・キュー深さ・承認セッション数・ローカルモデルの readiness を返すヘルスチェック。
- **STDIO MCP サーバー**: `pnpm --filter @mask-cut/mcp mcp:dev` (TS ソース) または `pnpm --filter @mask-cut/mcp mcp:serve` (ビルド済み JS) で起動し、`@modelcontextprotocol/sdk` を介して任意の MCP クライアントに接続できます。
- **承認 / チャット連携**: 既定では `AutoApprovalTransport` + `ConsoleChatRelayAdapter` で自動承認し、監査ログを JSON Lines (AuditTrailWriter) に記録します。実運用では独自トランスポートへ差し替えてください。

## 必要条件
- Node.js 20 以上 (ts-node/tsx での開発とネイティブ ES モジュールをサポートするため)
- pnpm 8.15.4 以上
- ローカルで到達可能な LLM バックエンド (Ollama / llama.cpp / custom script)。既定では `local-models/remote-openai-backend.mjs` が OpenAI 互換 API を呼び出します。
- OpenAI 互換 API キー (remote バックエンド利用時)

## クイックスタート
1. 依存関係をインストールします。
   ```bash
   pnpm install
   ```
2. 必須環境変数を設定します (PowerShell 例)。
   ```powershell
   $env:MASK_CUT_ENDPOINT_URL = "https://api.openai.com/v1"
   $env:MASK_CUT_MODEL_NAME  = "gpt-4o-mini"
   $env:MASK_CUT_API_KEY     = "sk-..."
   $env:MASK_CUT_VAULT_ID    = "mask-cut-dev"
   $env:MASK_CUT_TIMEOUT_MS  = "60000"
   $env:MASK_CUT_LOG_FILE    = "C:\Users\Junpei\app\Mask-Cut\apps\mcp\.logs\audit.log"
   ```
3. 開発サーバーを起動します。TypeScript ソースから STDIO サーバーを立ち上げたい場合は次を使用します。
   ```bash
   pnpm --filter @mask-cut/mcp mcp:dev
   ```
   ビルド済みアーティファクトで安定運用する場合は `pnpm --filter @mask-cut/mcp mcp:serve` を使用してください。
4. MCP クライアント (Claude / Codex 等) 側で STDIO サーバーを登録すると、`/mcp mask_text` と `mask-cut://masking/status` / `mask-cut://healthz` が利用できます。

## 環境変数
| 変数名 | 説明 | 既定値 |
| --- | --- | --- |
| `MASK_CUT_ENDPOINT_URL` | LLM API のベース URL。masking ツールの `endpoint` としてステータス出力にも含まれます。 | なし (必須) |
| `MASK_CUT_MODEL_NAME` | 呼び出すモデル ID。承認ログやチャット転送に記録されます。 | なし (必須) |
| `MASK_CUT_API_KEY` | LLM へのアクセスキー。`SecureStoreAdapter` 経由で keytar (未導入の場合はインメモリ) に保存されます。 | なし (必須) |
| `MASK_CUT_VAULT_ID` | SecureStore に保存する際のアカウント名。設定ファイルでは `endpointLabel` として利用されます。 | `mcp-default` |
| `MASK_CUT_TIMEOUT_MS` | LLM リクエストのタイムアウト (ミリ秒)。`mask-cut://healthz` にも露出します。 | `60000` |
| `MASK_CUT_LOG_FILE` | 監査ログ (JSON Lines) の出力先。未設定の場合はログを書き出しません。 | 未設定 |

## 設定ファイル: `apps/mcp/config/settings.json`
- `ConfigurationService` が初回起動時に自動生成します。`schemaVersion` / `updatedAt` / `endpointLabel` / `timeoutMs` / `logFile` / `localModel` を保持し、保存時には `localModel` のオフライン実行可否を検証します。
- `logFile` を設定すると `AuditTrailWriter` が承認・失敗イベントを JSON Lines で追記します。
- API キーは設定ファイルには書き込まれず、`endpointLabel` をキーとして keytar へ保存されます。
- 例:
  ```json
  {
    "schemaVersion": 1,
    "updatedAt": "2025-11-19T11:03:54.813Z",
    "endpointLabel": "mcp-default",
    "timeoutMs": 60000,
    "localModel": {
      "engine": "customScript",
      "modelPath": "C:\\Users\\Junpei\\app\\Mask-Cut\\apps\\mcp\\local-models\\remote-openai-backend.mjs"
    },
    "logFile": "C:\\Users\\Junpei\\app\\Mask-Cut\\apps\\mcp\\.logs\\audit.log"
  }
  ```

## ローカルモデル構成
### エンジン種別
- `customScript`: 任意の JS/TS (ESM) を実行し、`generate(request, context)` を実装します。`allowedScriptDirs` はリポジトリ直下と `apps/mcp/local-models/` が既定です。
- `ollama`: `http(s)://localhost:11434` のようにローカルホスト限定 URL のみ許可されます。
- `llamaCpp`: GGUF などのローカルファイル/ディレクトリを直接参照します。HTTP/S は拒否されます。

### カスタムスクリプト
`local-models/remote-openai-backend.mjs` は OpenAI 互換 API を直接呼び出すサンプルです。新しいスクリプトを追加する場合は `apps/mcp/local-models` 配下に配置し、`config/settings.json` の `localModel.modelPath` を更新してください。
```ts
// apps/mcp/local-models/echo-backend.mjs
export async function generate(request, context) {
  // context.config / context.env を利用できます
  return { text: request.prompt.toUpperCase() };
}
```
`customScript` では `warmup(context)` を定義すると起動時のヘルスチェックで呼び出されます。

### その他エンジン
現状の `LocalLlmGateway` は `customScript` バックエンドのみビルトインです。`ollama` や `llamaCpp` を利用する場合は、`LocalLlmGateway` 生成時に `backends` オプションへ自前のファクトリを DI するか、対応エンジンをラップするカスタムスクリプトを用意してください。

## 承認フローとチャット転送
- `AutoApprovalTransport` はプレビューを保存した上で即時承認を返します。インタラクティブな承認が必要な場合は `ApprovalTransport` を実装し、MCP 会話や別 UI から approve/reject/edit を送れるように差し替えます。
- `ConsoleChatRelayAdapter` は `[chat-relay] { ... }` を stdout に出力するだけです。実際のチャットサービスへ転送するには `ChatRelayAdapter` を実装し、`sendApprovedMessage` で外部 API を叩いてください。
- いずれも `createMcpRuntime` で依存を組み立てているため、必要に応じてファクトリ層で差し替えが可能です。

## 監査・ステータス・ヘルス
- **監査ログ**: `AuditTrailWriter` が `jobId`, `decision`, `inputBytes`, `maskedBytes`, `approvedAt`, `relayedAt`, `errorCode` を 1 行 JSON で保存します。
- **ステータスリソース**: `/mask-cut://masking/status` は `data.items` にジョブ配列を返します。例:
  ```json
  {
    "data": {
      "items": [
        {
          "jobId": "job-123",
          "state": "waiting-approval",
          "maskedText": "[PERSON] さん",
          "model": "gpt-4o-mini",
          "endpoint": "https://api.openai.com/v1",
          "locked": false
        }
      ]
    }
  }
  ```
- **ヘルスリソース**: `/mask-cut://healthz` は `endpoint`, `model`, `timeoutMs`, `queueDepth`, `approvalSessions`, `localModelReady` を含みます。監視ツールからのポーリングにも利用してください。

## npm / pnpm スクリプト
| コマンド | 説明 |
| --- | --- |
| `pnpm --filter @mask-cut/mcp dev` | `src/index.ts` を tsx で実行し、依存をダンプしてデバッグします。 |
| `pnpm --filter @mask-cut/mcp mcp:dev` | STDIO MCP サーバーを TypeScript ソースのまま起動します。 |
| `pnpm --filter @mask-cut/mcp build` | `tsc -p tsconfig.json` で `dist/` を生成します。 |
| `pnpm --filter @mask-cut/mcp mcp:serve` | ビルド済み STDIO サーバー (`dist/runtime/stdioServer.js`) を起動します。 |
| `pnpm --filter @mask-cut/mcp start` | プロダクション用に `dist/index.js` を実行します。 |
| `pnpm --filter @mask-cut/mcp lint` | TypeScript 型チェックを実行します。 |
| `pnpm --filter @mask-cut/mcp test` | Node.js Test Runner でユニットテストを実行します。 |

## MCP クライアントへの組み込み
### Claude CLI / Claude Desktop
```bash
claude mcp add --transport stdio mask-cut \
  --env MASK_CUT_ENDPOINT_URL=https://api.openai.com/v1 \
  --env MASK_CUT_MODEL_NAME=gpt-4o-mini \
  --env MASK_CUT_API_KEY=sk-... \
  -- pnpm --filter @mask-cut/mcp mcp:serve
```
`claude_desktop_config.json` の `mcpServers` に同等のコマンドを登録すると、Claude Desktop から `/mcp mask_text` と `mask-cut://` リソースを呼び出せます。

### Codex CLI
```powershell
codex mcp add mask-cut -- pnpm --filter @mask-cut/mcp mcp:serve
codex mcp list      # 登録確認
codex /mcp mask_text --inputText "..."
```
環境変数は Codex CLI のセッションに合わせて設定するか、`codex mcp add` 時に `--env` で渡してください。

## トラブルシューティング
- **`Missing required environment variables`**: `MASK_CUT_ENDPOINT_URL` など必須値が欠落しています。`.env` を読み込むか実行前に変数をエクスポートしてください。
- **`Local model path ... is not accessible`**: `localModel.modelPath` が `allowedScriptDirs` の外、または存在しないパスです。`apps/mcp/local-models` 配下に配置し直し、設定を再保存してください。
- **`No backend registered for engine ...`**: `LocalLlmGateway` に該当エンジンの `backend` がバインドされていません。`customScript` を使うか、`LocalLlmGateway` の生成箇所でファクトリを DI してください。
- **`Masking was rejected by the user`**: 承認フローから `reject` が返りました。`AutoApprovalTransport` を使っている場合は `edit` や `reject` を返すようカスタム実装を確認してください。
- **`Failed to start STDIO MCP server`**: ビルド済みファイルや依存が壊れている可能性があります。`pnpm --filter @mask-cut/mcp clean && pnpm --filter @mask-cut/mcp build` で再生成してください。

---
README は UTF-8 で保存しています。PowerShell から参照する際は `Get-Content -Encoding utf8` を利用してください。

