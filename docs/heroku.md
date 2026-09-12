# Heroku配置

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

クラウドURLをバンドルとネットワーク許可に同時設定します。ローカル.envは変更しません。生成した0.2.2のehpkをEven Hubへ取り込みます。既存設定にPCの接続先が保存されている場合は、スマホの「接続先」を上記HTTPS URLに変更してください。接続コードは従来と同じです。

ブラウザ/QRでの開発確認はクラウドURLを使えますが、ロック中の動作判断はBeta配布で実施してください。

## 実機確認

- PCを停止し、S24からモバイル通信でG2の英語→日本語を確認。
- 30〜60分の画面ロック中の集音・通信・字幕と電池消費を確認。
- この版は自動再接続を未実装。回線切断やHerokuの再起動時は表示を確認して手動で開始し直します。切断中の音声は復元できません。
- Herokuのディスクに履歴は保存しません。スマホの履歴は再読み込み前に保存してください。

公式: https://devcenter.heroku.com/articles/nodejs-support / https://devcenter.heroku.com/articles/dyno-restarts
