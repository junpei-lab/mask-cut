# Requirements Document

## Introduction
electron-appをWindows向けに確実にビルド・配布できるよう、ElectronランタイムやWindows固有アセット、配布パッケージ要件を満たすビルドプロセスを定義する。

## Requirements

### Requirement 1: Windowsビルド設定の統一
**Objective:** リリースエンジニアとして、Windows向けビルド設定を一元化したい。なぜなら、ブランド整合性のあるインストーラーとポータブル配布物を継続的に生成するためである。

#### Acceptance Criteria
1. When Windowsビルドをトリガーする, the Electron Windows Build Pipeline shall 出力設定に従ってWindows 10以降向けのインストーラー(.exe)とポータブルアーカイブを生成する。
2. If Windowsビルドのメタデータにアプリバージョンが設定されていない, the Electron Windows Build Pipeline shall ビルドを停止し、必須フィールドを明示した失敗理由を記録する。
3. While Windowsビルドジョブが進行している, the Electron Windows Build Pipeline shall Windows固有のアプリ名・アイコン・署名設定を適用してブランド一貫性を維持する。
4. Where ビルド対象が複数アーキテクチャを含む, the Electron Windows Build Pipeline shall 共有設定を使って各アーキテクチャの成果物を並列生成する。
5. The Electron Windows Build Pipeline shall 生成した各成果物の保存パスとハッシュ値をビルドマニフェストに記録する。

### Requirement 2: ツールチェーン検証と依存関係管理
**Objective:** ビルド担当者として、Windows固有のツールチェーン前提を自動検証したい。なぜなら、環境差異によるビルド失敗を未然に防止するためである。

#### Acceptance Criteria
1. When Windowsビルドを開始する, the Electron Windows Build Pipeline shall Node.js/Electronビルダー/Windows SDKバージョンを検証し、欠落時は分かりやすい手順を含む失敗ログを出力する。
2. If コードサイニング証明書または署名パスフレーズが未設定である, the Electron Windows Build Pipeline shall 署名なし成果物としてビルドを継続するかどうかを選択できる警告を提示する。
3. While ネイティブ依存パッケージをインストールしている, the Electron Windows Build Pipeline shall Windows向けのビルドツールチェーン(Visual C++ Build Tools 等)の有無をチェックし、欠落時はビルドを停止する。
4. Where 開発者ローカル環境からビルドを実行する, the Electron Windows Build Pipeline shall 必要な環境変数や前提ツールのチェックリストをログに出力する。
5. The Electron Windows Build Pipeline shall pnpmロックファイルの改変を検知した場合に、承認済みロックとの不整合を報告し、ビルド前に同期させる。

### Requirement 3: 成果物検証とリリースゲーティング
**Objective:** プロダクトオーナーとして、Windows成果物の品質を自動検証したい。なぜなら、マスキング機能がWindows配布物でも期待通り動作することを保証するためである。

#### Acceptance Criteria
1. When Windows成果物が生成される, the Electron Windows Build Pipeline shall 自動スモークテストでアプリ起動・マスキングフローの最小操作を検証する。
2. If スモークテストが失敗する, the Electron Windows Build Pipeline shall リリース候補を無効化し失敗ログと再現手順を添付する。
3. While リリース承認待ちである, the Electron Windows Build Pipeline shall ビルド成果物をアクセス制御されたステージング領域に保管し、改ざん検知のためのチェックサムを公開する。
4. Where 自動更新マニフェストが有効化されている, the Electron Windows Build Pipeline shall Windows成果物のURL・バージョン・SHAを最新のリリースマニフェストへ反映する。
5. The Electron Windows Build Pipeline shall 各ビルドについてコミットID・依存バージョン・テスト結果を含む監査ログを生成し、将来のトレースに備える。
