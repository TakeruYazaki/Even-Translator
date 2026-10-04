# Even Translator — Even G2 / Android

Galaxy S24（Android 16）とEven G2向けの英語→日本語字幕アプリ。現在のバージョンは **0.2.4** です。
Heroku配置・実機接続の手順は [docs/heroku.md](docs/heroku.md) を参照してください。
G2マイク → スマホのEven Hub WebView → Node.jsバックエンド → Deepgram Nova-3 → OpenAI Responses API → G2字幕、の構成です。

2026-10-04時点の実装・確認状況です。バックエンドはHerokuへ配置済みで、翻訳時にPCは不要です。Galaxy S24とG2によるクラウド翻訳・自動再接続・スマホのスリープ（画面ロック）中の動作をユーザーが確認しています。ロック試験の継続時間と配布方式は記録していないため、30〜60分の連続動作・電池消費まで確認済みとはしていません。

毎回のQR読み込みをなくすには、Even Hubへパッケージを登録し、スマホにインストールして利用します。クラウドへの配置だけではEven Hubへの登録・インストールは完了しません。

## 実装済み

- G2マイクのPCM16 LE / 16 kHz / mono音声を取得。スマホマイクには自動で切り替えません。
- API不要のマイク確認モード（音量、音声秒数、フレーム数、最大受信間隔）。
- Deepgram Nova-3英語ストリーミング、途中の原文表示、確定区間の翻訳。
- 用途に合わせた専門用語登録、英日訳語編集、背景情報の入力、TXT/MD読込み。
- OpenAIによる日本語訳。初期モデルは `gpt-4.1-mini`。`.env` の `OPENAI_MODEL` で変更可能。
- 否定・数値・単位・条件・統計的有意性を保ち、質問に回答せず訳す指示。
- 長い訳文をG2の複数ページに分割。最新追従中は新しい訳を優先表示し、前後移動と「最新へ」で履歴を参照。
- 原文・訳文・失敗理由の履歴、JSON保存、コピー用テキスト。
- タップで開始/停止、スクロールで字幕移動、ダブルタップで終了。
- 通常の停止は最後の認識と翻訳を待つ。終了操作・切断では未完了の翻訳を中断し、履歴に未受信と表示。
- スマホ→サーバーの通信切断・無応答からの自動再接続。停止・終了で再試行を中止。
- APIキーはバックエンドだけで保持。生音声はアプリ/サーバーのディスクに保存しません。

## 開発環境の最初の設定（PC）

Node.js 22とnpmが必要です。新規取得直後は、先に以下を実行して `.env` と接続コードを作成します。

```powershell
cd C:\Users\taker\Downloads\even-translator
npm.cmd ci
npm.cmd run setup
```

1. `.env` の `DEEPGRAM_API_KEY=` と `OPENAI_API_KEY=` を埋めて保存。
2. `APP_TOKEN` は自動生成した接続コード。変更しなくて構いません。
3. PCで `.local/connection-code.txt` を開き、その内容をスマホ画面の「接続コード」に入力します。

APIキーはフロントエンドの設定欄に入力しません。`VITE_` で始まる変数はアプリに公開されるため、キーを設定しないでください。
`.env` / `.local` はGit、Dockerビルド、開発Webサーバーの配信対象から除外しています。

`setup` は既存の `.env` を上書きしません。
GitHubから取得した場合、`.env`・接続コード・録音・翻訳記録・ビルド済みパッケージは含まれません。配布元のHerokuアプリを自動で利用するための認証情報も含まれません。自分のバックエンドを使う場合は、`scripts/configure-heroku.mjs`・`scripts/pack-heroku.mjs`・`scripts/live-smoke.ts` 内のアプリ名・URLも自分の配置先に合わせて変更してください。

## ローカル実機テスト

```powershell
cd C:\Users\taker\Downloads\even-translator
npm.cmd run dev
```

- スマホ用Web画面: `http://192.168.11.10:5173/`（作成時のPCアドレス）
- バックエンド: `http://127.0.0.1:8787`（Viteが `/ws` を中継）
- `dev` は両方を起動。`.env` の保存を検出してバックエンドだけを再起動します。翻訳中の変更は接続を切るので停止してから編集してください。
- ターミナルの `Ctrl+C` で停止。すでに5173/8787が使用中なら既存の開発サーバーを停止してから実行。
- 独立起動は `npm.cmd run dev:ui` と `npm.cmd run dev:server`。

```powershell
npm.cmd run qr -- http://192.168.11.10:5173
```

`.local/qr.png` をPCで開き、**Even Realities App内の開発者用QR読み込み**でスキャンしてください。
通常のカメラやChromeだけではG2に接続できません。PCとS24は同じルーターのLANに接続（PCは有線でも可）。
SDK 0.0.15の要求に合わせ、Even Realities Appは2.2.10以上が必要です。

### 推奨する確認順序

1. 以前のテストアプリを終了し、新しいQRを読み込む。
2. **マイク確認（API不要）**で開始。話すと音量が動き、音声秒数が増えることを確認。
3. 停止し、「接続・発表情報・専門用語」を開く。ローカル開発ではバックエンドURLは空欄。
4. 接続コードを入力して「接続確認」。これはサーバー接続とキーの設定有無の検査で、APIキーの有効性検査ではありません。
5. 必要に応じて背景情報・用語を編集し「設定を保存」。初期用語辞書は空で、特定の学会に限定していません。
6. **英語→日本語翻訳**に切り替えて開始。英語の音声をG2で拾い、英語原文、日本語字幕、履歴を確認。
7. 通常の「停止」で最後の訳まで届くこと、再開できることを確認。

初回のQRテストはスマホ画面を点灯したまま行います。ロック中の動作判定はBeta版で行います。
例: “Could you explain how you conducted the thematic analysis?”
例: “We did not find a statistically significant difference between the two groups.”

### 字幕と履歴

G2は概算で全角22文字×5行に分けます。最新追従中は新しい訳が届き次第、その訳の先頭ページに切り替えます。
長い訳の続きは4〜12秒で自動送りしますが、次の訳が届けば優先します。読み切れなかったページもスクロール・スマホの全文履歴で確認できます。
スクロールで過去の字幕を選ぶと自動送りは止まり、最後のページへ戻ると再開します。
スマホ画面には最新100件を表示し、JSON/コピー用テキストには保持中の全履歴を含めます。
履歴は再読み込みで消えます。JSONダウンロードがWebViewで動かない場合は「履歴をコピー用に表示」を使ってください。

## 精度と遅延の設計

- 未確定STTを翻訳しません。確定STTは句読点・発話区切り・長さ・最大約0.5秒の追加待ちでまとめます。Deepgramの無音区切り設定は300msです。短く区切ることで文脈が分断される影響は実機評価が必要です。
- 履歴に順番待ちと翻訳APIの所要時間を分けて表示します。音声認識の確定待ち・字幕通信時間は含みません。
- 同じ最終音声区間の再送は時刻で除外します。実際に繰り返された発言は除外しません。
- 翻訳は順序を保って逐次処理し、直前4区間と発表概要を参照します。
- Deepgramに渡すのは英語用語。日本語訳語は翻訳モデルへ渡します。初期アプリでは用語50件、英語部分の合計500 UTF-8バイトまでに制限しています。
- 発表資料によって音声の内容を補完しないよう指示していますが、精度の保証ではありません。
- 履歴の「順番待ち」「翻訳API」はサーバーで計測します。合計値には認識確定前の待ち・ネットワークでの配信・G2表示時間を含まず、発話開始からG2実表示までの総遅延ではありません。

## 切断・停止

- スマホ→サーバーの通信切断または12秒以上の無応答を検出すると、マイクを停止して再接続します。待ち間隔は1・2・4・8・15・15秒、最大6回。30秒以上安定して接続した後の切断では試行回数をリセットします。
- 再接続成功後は翻訳を自動再開します。既存の履歴と背景情報・用語設定は維持しますが、サーバー側の直前の会話文脈は引き継ぎません。
- 通信が切れた区間の録音・自動再送は行いません。再試行上限に達したら、回線を確認して手動で開始してください。
- 停止・終了で再試行を中止します。停止処理中の切断、サーバーが返したAPI認証/利用枠エラー、過大な待ち行列、G2マイクエラーでは自動再開しません。
- サーバーは音声未受信15秒、スマホ通信未受信20秒、連続70分を停止条件にしています。
- マイク確認モードは外部送信しません。音声未受信5秒を画面に表示します。
- スマホの画面非表示だけを理由にマイクを停止する処理は入れていません。ユーザーの実機ではロック中の動作を確認済みですが、OSがEven App自体を停止した場合、この再接続処理も動作しません。

## 自動検証

```powershell
npm.cmd test
npm.cmd run test:ui
npm.cmd run pack
```

`test:ui` はPCのMicrosoft Edgeをヘッドレスで使用します。G2の橋渡しとAPI応答を模擬したテストで、実機・実APIの代替ではありません。
`npm.cmd run pack` は型検査、Webビルド、バックエンドのコンパイル、`.ehpk` 作成まで実行します。

実APIの疎通テスト（短い合成英語音声を送信し、API従量料金が発生）:

```powershell
powershell.exe -NoProfile -File scripts/make-test-audio.ps1
npm.cmd run test:live
```

両APIキーの保存後に実行してください。結果は `.local/live-smoke.json`。
合成音声のテストであり、G2の集音精度は別途実機で確認します。

## スマホとG2だけで使う

配置済みのバックエンドは `https://even-translator-b7d8bf8c2521.herokuapp.com/` です。2026-09-12に0.2.4をHerokuのBasic web dyno 1台へ配置し、起動を確認しています。スマホのインターネット接続は必要です。

| 作業 | 使う端末 |
| --- | --- |
| `npm.cmd run pack:heroku` でクラウド接続用パッケージを作成 | PC |
| Even Hub開発者ポータルでプロジェクト・Betaグループを作成し、`.ehpk`をアップロード・配布 | PCのブラウザ |
| Even Appで自分のBeta版をインストールし、接続コードを設定 | スマホ |
| インストールしたアプリをホームから起動して翻訳 | G2とスマホ（PC・毎回のQR読み込みは不要） |

アプリ名は **Even Translator**、package_idは `com.taker.eventranslator`。配布用ファイルは `even-translator-0.2.4.ehpk` です。旧IDのプロジェクトとは別扱いになるため、旧版を登録済みの場合は新しいIDで登録してください。

`pack:heroku` はローカル `.env` を変更せず、バンドルと通信許可にHerokuのHTTPS/WSS接続先を設定します。スマホにPCの接続先が保存されている場合は上記URLに変更します。Herokuの環境変数設定・配置更新は [docs/heroku.md](docs/heroku.md) を参照してください。Herokuの `PORT` は自動割り当てです。

`npm.cmd run pack` は汎用のパッケージ作成コマンドです。`VITE_BACKEND_URL` 未指定ならローカル確認用になるため、現在のHeroku向けには `pack:heroku` を使ってください。

Dockerfileも用意していますが、Dockerでのビルド・配置は未検証です。今回のHeroku配置はNode.jsのビルド方式を使っています。Node.jsだけなら `npm ci`, `npm run build`, `npm start` でも動作します。
リバースプロキシはWebSocket Upgradeと長時間接続に対応させ、TLSはホスティング側で終端します。
`.env` やAPIキーはDockerイメージへ含めません。

## 確認済みと残る作業

- 0.2.4作成時に自動テスト27件・型検査・ビルドが成功。今回の文書更新に伴うテスト再実行はしていません。
- 実APIによるクラウド経由の合成音声翻訳、ユーザーによる実機翻訳・自動再接続・画面ロック中の動作を確認済み。
- 30〜60分の連続運転と電池消費、学会会場での集音・精度の比較は確認記録なし。
- 履歴の自動保存は未実装。設定は端末へ保存しますが、翻訳履歴は再読み込みで消えます。必要なら終了前にJSON保存またはコピーしてください。

## 構成

- `src/`: スマホUI・G2操作・音声バッチ・字幕ページ分割
- `shared/`: 通信型と背景情報の検証、汎用の初期設定
- `server/`: WebSocket認証、音声認識、翻訳キュー、静的配信
- `scripts/`: 起動、パッケージ、QR、設定、実APIテスト
- `tests/`: 自動テスト。模擬SDKはテスト時だけ注入し、本番へは含めない
- `dist/`: G2向けWebアプリ
- `build-server/`: コンパイルされたNodeバックエンド
- `even-translator-0.2.4.ehpk`: 実機取り込み用パッケージ（Git対象外、ビルドで生成）
- `.local/display-test-0.1.0/`: 実機確認済みの旧表示テストのソース控え

## 公式資料

元の表示処理はEven Realities公式MITテンプレートを基にしています。LICENSEを同梱。

- https://github.com/even-realities/evenhub-templates/tree/main/asr
- https://hub.evenrealities.com/docs/build/device-apis
- https://hub.evenrealities.com/docs/build/networking
- https://hub.evenrealities.com/docs/test/beta-testing
- https://developers.deepgram.com/docs/understand-endpointing-interim-results
- https://developers.deepgram.com/docs/audio-keep-alive
- https://developers.deepgram.com/docs/keyterm
- https://developers.openai.com/api/docs/models/gpt-4.1-mini
- https://developers.openai.com/api/docs/guides/structured-outputs
