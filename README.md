# tableau-public-mcp-app

Tableau Public の viz をチャット内にインライン表示し、**ユーザーの操作状態をモデルに共有する** MCP Apps サーバーです。

> **実験的プロジェクトです。** MCP Apps (SEP-1865) とホスト各社の実装が固まる前の検証用に書いたもので、API は予告なく変わります。
> Tableau および Salesforce の公式製品ではなく、両社とは無関係です。

## できること

- **インライン表示**
  - Tableau Public の viz を Embedding API v3 の `<tableau-viz>` で全面埋め込みします
  - ウィジェットはチャット内のカードとして描画されます
- **状態スナップショット**
  - ユーザーのフィルター変更・マーク選択などを検知します
  - いま画面に出ている数字がモデルへ push されます
  - モデルは再クエリなしでそれを参照できます
- **認証層なし**
  - Tableau Public は匿名アクセスです
  - JWT・Connected App といった認証層は一切不要です

## セットアップ

```bash
npm install && npm run build && npm start
```

Node.js 20 以上が必要です。HTTP のみで、`/mcp` に MCP エンドポイント、`/health` に稼働確認をマウントします。ポートは環境変数 `PORT`（既定 3000）。Web ホストから接続する用途なので stdio トランスポートは持ちません。

ここから先は、検証したい範囲によって3段階に分かれます。

### 1. ウィジェット単体（ローカル、MCP クライアント不要）

`/widget` を素のブラウザで開きます。

```
http://localhost:3000/widget?viz=https://public.tableau.com/views/WorkbookName/ViewName
```

Embedding API による埋め込み・操作・状態キャプチャまで動きます。最後に取得したスナップショットは devtools で `window.__LAST_VIZ_STATE` から見えます。ただし push 先のホストが無いため、**モデルには何も渡りません**。

`?height=<px>` で高さを、`?debug` で診断オーバーレイを追加できます。これらのクエリパラメータは standalone 専用です。ホスト経由のウィジェットは、viz URL も高さも常にホストから受け取ります。

### 2. ローカル MCP クライアント（通しの動作確認）

MCPJam Inspector のようなローカルで動く MCP クライアントを、`http://127.0.0.1:3000/mcp` に Streamable HTTP で接続します。

ツール呼び出しからウィジェット描画、ホストブリッジ経由の状態 push まで、経路が通しで検証できます。公開デプロイなしで到達できるのはここまでです。

### 3. ChatGPT / Claude などの Web ホスト

これらのホストは localhost に到達できません。**公開 HTTPS が必須**です。

トンネル（開発用）か任意の PaaS でサーバーを公開し、次節の手順で登録してください。

## ホストへの接続

サーバーを公開 HTTPS で動かし、`https://<ホスト>/mcp` を登録します。

サーバーは stateless です。プロトコルレベルのセッションを持たず（`Mcp-Session-Id` を発行しません）、各リクエストに独立して応答するため、複数インスタンスに分散しても動きます。GET の SSE ストリームは提供せず 405 を返しますが、サーバー→クライアント通知を使わないため機能上の欠落はありません。

準拠しているのは MCP `2025-11-25` 世代です。最新の `2026-07-28` には未対応で、その理由と移行に要る作業は [docs/protocol-status.md](docs/protocol-status.md) にあります。

- **ChatGPT** — Settings → Apps & Connectors → 開発者モードでカスタムコネクタを追加します（認証なし）。未レビューのコネクタは「CSP オフ」表示で動作します。ツール定義とウィジェット HTML は登録時にキャッシュされるため、サーバー更新後はコネクタ詳細の「更新する」で再取得してください
- **Claude / MCPJam 等** — Streamable HTTP のリモート MCP サーバーとして同じ URL を登録します

メタデータは標準（SEP-1865）と OpenAI legacy の2方言を併記しているため、同じサーバーが両系統でそのまま動きます。

## ツール: `show_viz`

ツールはこれ1本です。

| 引数 | 型 | 必須 | 内容 |
|---|---|---|---|
| `path` | string | 省略可 | `WorkbookName/ViewName`、または `https://public.tableau.com/views/...` の完全 URL |
| `height` | int (240–3000) | 省略可 | ウィジェット高さの px 明示指定。通常は省略します（自動で決まります） |

`path` を省略すると、既定の [Developer Superstore](https://public.tableau.com/views/DeveloperSuperstore/Overview) を表示します。`public.tableau.com` の `/views/` 以外の URL は拒否するため、ウィジェットが任意のオリジンを frame することはありません。

返す `structuredContent` は `vizUrl` と、`height` 指定時のみ `heightPx` です。

### ダッシュボード設計の目安

- **幅は 750px 以下** の固定サイズ、または「自動」サイズにします。カード幅はホストが決めるうえに一定とは限らないため、狭い側に倒しておくのが安全です
- **高さは指定不要です。** ダッシュボードの公開サイズからウィジェットが自動計算します

寸法の実測値と高さ決定ロジックの詳細は [docs/chatgpt-host-notes.md](docs/chatgpt-host-notes.md) にあります。

## Viz 状態スナップショット

ユーザーが viz を操作すると、ウィジェットが Embedding API で現在の状態を読み取り、スナップショットとしてホストへ push します。

- **内容**
  - フィルター — categorical / range / relative-date。`appliedTo` 付き
  - パラメーター
  - 選択マーク
  - アクティブシート
  - サマリーデータ — 1シート、上限200行
- **経路**
  - SEP-1865 ホスト — `updateModelContext`
  - ChatGPT — `setWidgetState`
  - どちらも無いホスト — viz 表示だけが動きます
- **挙動**
  - イベントを 2 秒 debounce し、1回のキャプチャに集約します
  - Embedding API 呼び出しは直列かつタイムアウト付きです（ハングした postMessage チャネルは再起不能のため）
  - ペイロードは 30KB の予算に収まるまで段階的に間引きます。削る順は、データ行 → 選択マーク → フィルター詳細 → 識別情報のみ、です

30KB は自主規制です。ホストがウィジェット由来のモデルコンテキストに設ける上限は非公開で、超過はエラーで拒否されるのではなく、ウィジェットが復旧不能になる形で現れるホストがあります。そのため確実に下回る値まで削ってから送ります。

このキャプチャパイプラインは、tableau-mcp-eas-auth フォークの vizState モジュールの移植です。Tableau Public 向けに datasource 参照を削除してあります。

### データ共有の制約

データは渡りますが、渡り方が限定されています。モデルにデータを問い合わせさせる用途には使えません。

- **モデルから要求できません。** データ取得ツールは実装していないので、モデルが追加のデータを取りにいく手段はありません。ユーザーが操作したときにウィジェットが push する内容を受け取るだけです
- **1シートだけです。** ダッシュボードでは1つのワークシートしか読みません。他シートのデータは含まれず、その旨が caveat として付きます
- **200行・先頭ページだけです。** ページングはしません
- **サマリーデータだけです。** 画面に表示されている集計値であって、基になる詳細行ではありません
- **予算超過で真っ先に落ちます。** 30KB を超えると、間引きの最初の段でデータ行から削られます

サーバー側からデータを問い合わせる経路もありません。Tableau Public は REST API・Metadata API・VizQL Data Service のいずれの対象でもないためです。データ読み取りはすべて、ブラウザ内の Embedding API 経由になります。

## 開発

```bash
npm run dev        # ビルドして tsx で直接起動
npm run typecheck  # 型検査のみ
```

`npm run build` は2段構えです。まずウィジェット側コード（`src/view/`）を esbuild で単一バンドルに固め、`src/generated/viewBundle.ts` を生成します。その後サーバーを tsc でビルドします。この生成物は git 管理外なので、`build:view` を飛ばすとサーバーのビルドが import に失敗します。

| パス | 役割 |
|---|---|
| [src/index.ts](src/index.ts) | MCP サーバー本体。ツール定義、リソース、Express のルーティング |
| [src/view/](src/view/) | ウィジェット側。埋め込み、状態キャプチャ、ホストブリッジ |
| [archive/iframe-probe/](archive/iframe-probe/) | 前身の調査サーバー。ホストの iframe 対応状況を CSP と sandbox 継承の2軸で実測した記録（[results/](archive/iframe-probe/results/)）。ビルド対象外 |

## ライセンス

MIT
