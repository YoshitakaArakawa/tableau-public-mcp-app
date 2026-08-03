# tableau-public-mcp-app

Tableau Public の viz をチャット内にインライン表示する、最小構成の MCP Apps サーバー。

ツールは `show_viz` 1本。呼び出すと、Tableau Public のサンプル viz（Developer Superstore）を全面 iframe で埋め込んだウィジェットが描画される。

メタデータは2方言を併記している。

- 標準（SEP-1865）: `_meta.ui.resourceUri` / `_meta.ui.csp.frameDomains`
- OpenAI legacy: `openai/outputTemplate` / `openai/widgetCSP.frame_domains`

これにより Claude 系ホストと ChatGPT の両方で同じサーバーがそのまま動く。ChatGPT Plus（開発者モードのカスタムコネクタ、CSP オフ表示）で描画・ツールチップ操作まで動作確認済み。

## 起動

```bash
npm install && npm run build
npm start
```

HTTP のみ（`/mcp` にマウント、`/health` で稼働確認）。Web ホストから接続する用途なので stdio は持たない。ポートは `PORT`（既定 3000）。

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
