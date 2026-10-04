# Heroku配置

2026-10-04追記: 現行は0.2.4。ユーザーがクラウド経由の実機翻訳・自動再接続・スマホのスリープ（画面ロック）中の動作を確認済みです。試験時間と配布方式の記録はなく、30〜60分連続運転・電池消費までの確認ではありません。以下の日付・バージョン別の結果は当時の記録です。

対象: `even-translator` / US / heroku-24 / Basic web dyno 1台。
URL: https://even-translator-b7d8bf8c2521.herokuapp.com/

## 設定・配置

```powershell
node --env-file=.env scripts/configure-heroku.mjs
git push heroku main
heroku ps:scale web=1:Basic --app even-translator
heroku ps --app even-translator
```

configure-herokuはログイン中のHeroku CLI認証を使い、ローカル.envのAPIキー・接続コード・翻訳モデルとクラウド設定を対象アプリのConfig Varsに転送します。秘密値をログやコマンド引数に出しません。既存セッションがある場合、Config Vars変更で再起動します。

HerokuはNode 22で依存をインストールし、heroku-postbuildでフロントとバックエンドをビルドします。Procfileはコンパイル済みサーバーを起動します。PORTはHerokuが割り当て、HOSTは0.0.0.0です。追加データベースは使いません。

## G2用パッケージ

```powershell
npm.cmd run pack:heroku
```

クラウドURLをバンドルとネットワーク許可に同時設定します。ローカル.envは変更しません。生成した0.2.4のehpkをEven Hubへ取り込みます。既存設定にPCの接続先が保存されている場合は、スマホの「接続先」を上記HTTPS URLに変更してください。接続コードは従来と同じです。

0.2.4のアプリ名はEven Translator、package_idはcom.taker.eventranslatorです。旧パッケージIDで既に登録している場合、新しいプロジェクトとして登録してください。スマホに保存済みの背景情報・用語は自動消去しません。汎用用途で試す場合は設定画面で変更してください。旧バージョンのehpkは過去の成果物なので、新規登録には0.2.4を使用します。

ブラウザ/QRでの開発確認はクラウドURLを使えますが、ロック中の動作判断はBeta配布で実施してください。

## 実機確認

- PCを停止し、S24からモバイル通信でG2の英語→日本語を確認。
- 30〜60分の画面ロック中の集音・通信・字幕と電池消費を確認。
- 0.2.3はスマホ→サーバーの切断・12秒以上の無応答を検出し、自動再接続します。1/2/4/8/15/15秒の間隔で最大6回試行し、30秒以上安定して接続できた後は回数をリセットします。
- 再接続中はマイクを停止。切断中の音声は保持・再送しません。未受信の訳は履歴に欠落として表示し、既存の訳は保持します。復帰時は新しいSTTセッションのため直前の会話文脈は引き継ぎません。
- 停止・タップ・終了で再接続を中止。認証・API設定などサーバーが明示したエラー、G2マイクエラーは自動再試行しません。停止処理中の切断も自動再開しません。
- Herokuのディスクに履歴は保存しません。スマホの履歴は再読み込み前に保存してください。

公式: https://devcenter.heroku.com/articles/nodejs-support / https://devcenter.heroku.com/articles/dyno-restarts

## 2026-09-12 確認結果

- Herokuリリースv4、Basic web 1台で起動。HTTPSページ/healthは200、秘密ファイルは404。配信JSにAPIキー・接続コードがないことも確認。
- ローカルの自動テスト22件と型検査に成功。Heroku Linux上のビルド・起動も成功。
- 11.425秒の合成英語音声をHerokuのWSSへ送り、3文の日本語訳と正常停止を確認。翻訳API所要時間は約3.0/2.2/1.9秒。全体遅延ではなく、PC版と同時条件で比較した結果でもありません。
- 実機のクラウド接続とロック中連続動作は未確認。
- クラウド用QRは `.local/qr-heroku.png`、取り込み用は `even-translator-0.2.2.ehpk`。

実APIのクラウド疎通テスト（従量料金が発生）:

```powershell
$env:LIVE_BACKEND_URL='https://even-translator-b7d8bf8c2521.herokuapp.com'
npm.cmd run test:live
Remove-Item Env:LIVE_BACKEND_URL
```

結果: `.local/live-smoke-heroku.json`。

## 0.2.3の確認

ユーザーが0.2.2のクラウド経由の実機動作を確認。0.2.3では模擬WebSocketで切断→接続失敗→復帰、再接続中の停止/終了、無応答、最大試行回数を検証します。AndroidがEven App自体を停止した状態では、このアプリの再接続処理も動きません。ロック中の連続動作と実回線切替は引き続き実機確認が必要です。
