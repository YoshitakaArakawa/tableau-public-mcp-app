# tableau-public-mcp-app

Tableau Public の viz をチャット内にインライン表示し、**ユーザーの操作状態をモデルに共有する** MCP Apps サーバー。

ツールは `show_viz` 1本。`path`（`WorkbookName/ViewName` または public.tableau.com の /views/ URL、省略可）で指定した viz を、Embedding API v3 の `<tableau-viz>` で全面埋め込みしたウィジェットが描画される。Tableau Public は匿名アクセスなので、JWT・Connected App 等の認証層は一切ない。

## Viz 状態スナップショット

ユーザーが viz を操作する（フィルター変更・マーク選択など）と、ウィジェットが Embedding API で現在の状態を読み取り、スナップショットとしてホストへ push する。モデルは「いま画面に出ている数字」を再クエリなしで参照できる。

- 内容: フィルター（categorical / range / relative-date、appliedTo 付き）、パラメーター、選択マーク、アクティブシート、サマリーデータ（1シート・上限200行）
- 経路: SEP-1865 ホストは `updateModelContext`、ChatGPT は `setWidgetState`。どちらも無いホストでは viz 表示だけが動く
- 挙動: イベントを 2 秒 debounce して1回のキャプチャに集約。Embedding API 呼び出しは直列 + タイムアウト付き（ハングした postMessage チャネルは再起不能のため）。バイト予算に収まるまで段階的に間引く
- 実装は [src/view/](src/view/) 配下。キャプチャパイプラインは tableau-mcp-eas-auth フォークの vizState モジュールの移植（Tableau Public 向けに datasource 参照を削除）

## サイズ実測(ChatGPT、20260803)

`show_viz` の `height` 引数(px、実測用)とウィジェット内の診断オーバーレイ(viewport・`window.openai` のサイズシグナル・fullscreen 要求ボタン)で計測した結果:

- インラインカードのウィジェット幅は **~768px で一定**。ブラウザ窓幅を変えても変わらない(会話カラム幅に張り付く)
- カードの高さは**ウィジェットのコンテンツ高に 1:1 で追従**する。既定 480px は「コンテンツが `100vh` で枠を埋める」場合の平衡値で、コンテンツを 1200px / 3000px にするとカードもそのまま 1200 / 3000px になった(上限は未到達)
- `window.openai` には `notifyIntrinsicHeight` / `notifyIntrinsicWidth` / `requestDisplayMode` があり、`maxHeight` / `maxWidth` キーは存在するが inline 時は未配信(undefined)だった
- `requestDisplayMode({mode:"fullscreen"})` は許可され、viewport 767×480 → 1354×934 に拡大。固定サイズのダッシュボードは fullscreen でも元サイズのまま(余白が広がるだけ)
- ChatGPT はツール定義(スキーマ)もウィジェット HTML(リソース)もコネクタ登録時にキャッシュし、再接続では更新しない。サーバー側の変更を確実に反映するにはコネクタの削除→新規作成が必要(更新タイミングの正確な規則は未確定)
- ChatGPT はページリロード時にツール結果(`toolOutput`)をウィジェットへ再配信しない。リロード後の表示復元は `setWidgetState` に保存した `restore` ブロック(viz URL・高さ)をウィジェットが読み戻すことで行う

ダッシュボード設計の目安: 幅 750px 以下の固定または「自動」サイズ。高さはウィジェットが自動調整する(下記)。

高さの決まり方(優先順): `height` 引数の明示指定 > ダッシュボードの公開サイズからの自動計算(exactly / range の公開高さ + ツールバー35px、480〜1200 にクランプ)> 既定(ホスト枠 = ChatGPT では 480px)。「自動」サイズのダッシュボードは既定高さに自身が追従する。Embedding API の内部 iframe は viewport 基準で作られるため、ウィジェットが shadow DOM 経由で wrap の高さに強制同期している。

メタデータは2方言を併記している。

- 標準（SEP-1865）: `_meta.ui.resourceUri` / `_meta.ui.csp.frameDomains`
- OpenAI legacy: `openai/outputTemplate` / `openai/widgetCSP.frame_domains`

これにより Claude 系ホストと ChatGPT の両方で同じサーバーがそのまま動く。

## 起動

```bash
npm install && npm run build
npm start
```

HTTP のみ（`/mcp` にマウント、`/health` で稼働確認）。Web ホストから接続する用途なので stdio は持たない。ポートは `PORT`（既定 3000）。

`npm run build` はウィジェット側コード（`src/view/`）を esbuild で単一バンドルに固めて `src/generated/viewBundle.ts` を生成し、その後サーバーを tsc でビルドする。`/widget?viz=https://public.tableau.com/views/...` で ウィジェット HTML を素のブラウザでも開ける（ホスト無しの動作確認用。最後のスナップショットが `window.__LAST_VIZ_STATE` で見える）。ホストから viz URL が届かない限りウィジェットは何も表示しない — デフォルト viz へのフォールバックは意図的に置いていない。

## デプロイ (Fly.io)

```bash
fly deploy --ha=false
```

`--ha=false` は必須。セッションをメモリで保持しているため、マシンが2台あると initialize と後続リクエストが別マシンに散って 400 になる。

エンドポイント: `https://tableau-public-mcp-app.fly.dev/mcp`

## ホストへの接続

- **ChatGPT**: Settings → Apps & Connectors → 開発者モードでカスタムコネクタを追加（認証なし）。未レビューのコネクタは「CSP オフ」表示で動作する
- **Claude / MCPJam 等**: Streamable HTTP のリモート MCP サーバーとして上記 URL を登録

## archive/

`archive/iframe-probe/` に、このリポジトリの前身である **MCP Apps iframe 対応状況の調査サーバー**一式（ソース・検証手順・ホスト別の実測結果）を保存している。主な調査結果:

- MCPJam Inspector 2.32.0: CSP を強制しない（宣言に関係なく外部 iframe が通る）
- Claude Desktop: `frameDomains` を承認レスポンスに載せるが、実際の CSP に反映せず iframe をブロックする（仕様乖離）
- ChatGPT Plus: CSP オフ表示の下で外部 iframe が完全動作

詳細は [archive/iframe-probe/README.md](archive/iframe-probe/README.md) と [archive/iframe-probe/results/README.md](archive/iframe-probe/results/README.md) を参照。

## ライセンス

MIT
