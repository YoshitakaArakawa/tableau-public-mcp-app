# ChatGPT (Plus, Web) / Streamable HTTP

計測対象はプローブ4種ではなく、シンプル版サーバー `tableau-public-mcp-app`（`show_viz` 1本）。
接続先: `https://tableau-public-mcp-app.fly.dev/mcp`（Fly.io、認証なし、開発者モードのカスタムコネクタ）

## 環境

| 項目 | 値 |
|---|---|
| ホスト | ChatGPT Plus（chatgpt.com、Claude Desktop 内ブラウザで操作） |
| トランスポート | Streamable HTTP（HTTPS 必須。ローカル stdio は接続不可） |
| 検証日 (YYYYMMDD) | 20260803 |
| サーバー | tableau-public-mcp-app 0.1.0（commit a31dcec） |
| メタデータ | SEP-1865 `_meta.ui.*` + legacy `openai/*` の両方言を併記 |

## 結果

| 項目 | 結果 |
|---|---|
| ウィジェット描画 | **yes** — チャット内にインラインカードとして描画 |
| 外部 iframe（Tableau viz） | **yes** — フィルタ UI・地図・バブルまでフル描画 |
| 操作可能 | **yes** — ホバーでツールチップ実測（"Washington - 98103 / Profit Ratio 19.5% / Sales 36,542 / Profit 7,118"） |
| ツール呼び出し | yes — モデルが `show_viz` を正しく選択・実行 |

## 重要な但し書き: 「CSP オフ」バッジ

ウィジェット右上に **「CSP オフ」** バッジが表示されていた。未レビューの開発者モードコネクタは、宣言 CSP の強制なしで動作している状態と解釈できる（コネクタ設定時に「セキュリティレビューが必要」の案内あり。公式ドキュメントも frame domains の宣言は厳格レビュー対象と明記）。

つまりこの成功は **CSP 非強制下での成功** であり、「ChatGPT が frameDomains を尊重して frame-src を開けた」ことの証拠にはならない。MCPJam の素通しと同じ構図。レビュー通過後（CSP 有効時）に同じ表示が維持されるかは**未検証**。

## 補足観測

- OpenAI 公式ドキュメント（developers.openai.com/apps-sdk/reference）は現在、標準の `_meta.ui.*` を推奨形式、`openai/widgetCSP` 等を legacy 扱いとしている。`openai/widgetCSP` には `frame_domains` フィールドがあり「既定ではサブフレーム不可、宣言でオプトイン」と明記
- mimeType は SEP-1865 の `text/html;profile=mcp-app` のままで描画された（`text/html+skybridge` への変更は不要だった）
- View 側は postMessage / window.openai を一切使わない純静的 HTML。それでも描画・埋め込みとも動作した
- Fly.io 側の注意: マシン2台（HA 既定）だとメモリ保持セッションが分散して 400 になる。`--ha=false` 必須

## スクリーンショット

会話ログ内（20260803 の ChatGPT 検証）に2枚: 描画全体 / ツールチップ表示中。ファイルとしては未保存。

## 未解決

- セキュリティレビュー通過後（CSP 有効時）の挙動
- SEP-1865 の `ui/initialize` ハンドシェイクに ChatGPT が応答するか（今回の View は静的 HTML のため未測定。プローブサーバーを HTTPS デプロイすれば測定可能）
