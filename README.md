# mcp-apps-iframe-probe

MCP クライアント（ホスト）が **MCP Apps (SEP-1865)** の入れ子 iframe をどこまでサポートするかを実測するための、最小限の MCP サーバー。

測定するのは2軸。

1. **CSP** — ホストが `_meta.ui.csp.frameDomains` を尊重して `frame-src` を開けるか
2. **sandbox 継承** — View の iframe に `allow-same-origin` がない場合、中の外部コンテンツは opaque origin に置かれる。frame-src が通っても白画面になりうる

埋め込みサンプルには Tableau Public の viz を使うが、Tableau 固有機能は一切扱わない。認証不要でクロスオリジンの重量級 Web アプリを埋め込める素材として選んでいるだけ。

## ステータス

スキャフォールド段階。実装はこれから。

## ライセンス

MIT
