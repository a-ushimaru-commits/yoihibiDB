# 月次推移(ブランド選択式・色分け) 改修設計書

## 背景

前回追加した「月次推移（ブランド×定期/通常）」の広いピボット表(33ブランド×4列=約130列)は、横スクロールが必須で読みにくいというフィードバックを受けた。ヒアリングの結果、以下に変更する:

- ブランドごとに切り替える**選択式(Excelのシートタブのように)**表示に変更。1度に見えるのは「全体(合計)」または選択した1ブランドの月次推移のみ
- 定期/通常の列に**背景色**を付けて区別する(定期=青系、通常=緑系)
- 売上・粗利のセルに**ヒートマップ**(値が大きいほど色濃く、マイナスは赤系)を追加する

広いピボット表(`renderBrandMonthlyPivotHTML`)はこの機能で置き換えて削除する。ただし内部の集計(`getBrandMonthlyPivot`)は月×ブランド×定期通常の生データを持つため、新機能の内部実装として再利用する。

## 集計: `getBrandMonthlySeries(state, selection)`

`js/aggregate.js`に新関数を追加し、既存の`getBrandMonthlyPivot`の結果を選択条件で射影する。

```
getBrandMonthlySeries(state, selection) -> {
  brands: string[],   // getBrandMonthlyPivotのbrandsそのまま(セレクタの選択肢用)
  rows: [
    { yearMonth, teikiSales, teikiProfit, tsujoSales, tsujoProfit },
    ...
  ]
}
```

- `selection`が`'ALL'`(または未指定)のときは、各月の全体合計(`totalTeikiSales`等)を使う
- `selection`がブランド名のときは、各月の`byBrand[selection]`を使う。その月にそのブランドのデータが無ければ0埋め

## 表示: `renderBrandMonthlySeriesHTML(series, selection)`

`js/ui.js`に新関数を追加する。`renderBrandMonthlyPivotHTML`は削除する。

- 先頭に`<select id="brandSeriesSelect">`を置き、`全体(合計)`(value=`ALL`)+ `series.brands`の各ブランド名を選択肢にする。`selection`と一致する項目に`selected`
- 表: 月 / 定期売上 / 定期粗利 / 通常売上 / 通常粗利 の5列、1行=1か月
- 定期売上・定期粗利のセルに背景色クラス(青系)、通常売上・通常粗利のセルに背景色クラス(緑系)を付ける
- 売上・粗利それぞれの列について、全行の絶対値の最大値を求め、値の絶対値/最大値の比率をもとにインラインstyleで背景色の濃淡を追加する(値がプラスなら緑系、マイナスなら赤系のヒートマップ、列背景色の上に重ねる形で少し透過させる)
- ブランドが1つも登場していない場合は空状態メッセージ(既存の`renderBrandTableHTML`と同様のパターン)

## 配線

`js/main.js`にモジュールスコープの変数(例: `let selectedPivotBrand = 'ALL';`)を持ち、`renderAll()`内で`getBrandMonthlySeries(state, selectedPivotBrand)`→`renderBrandMonthlySeriesHTML(...)`を呼ぶ。描画後に`<select id="brandSeriesSelect">`へ`change`イベントを付け直し(既存の`setupBrandAssignForm`と同じ「毎回描画後に付け直す」パターン)、選択が変わったら`selectedPivotBrand`を更新して`renderAll()`を再実行する。

`dashboard.html`・`css/styles.css`から古いワイドピボット表関連の要素は残らない(コンテナdivは共通、中身の関数呼び出しだけ差し替え)。

## スコープ外

- 1期比較(YoY)列はこの表には引き続き含めない(前回の設計判断を踏襲)
- ヒートマップの配色は簡易な2色スケール(プラス=緑系、マイナス=赤系)とし、複雑なグラデーションライブラリは使わない

## テスト方針

- `getBrandMonthlySeries`の単体テスト(`'ALL'`選択、ブランド選択、データの無いブランド選択時の0埋め)
- `renderBrandMonthlySeriesHTML`の単体テスト(セレクタの選択肢生成、選択中ブランドの`selected`、定期/通常の背景色クラス、空状態)
- 実データでのPlaywright検証(既存のチャネル別KPI数値に影響がないことの回帰チェック、ブランド切り替えで表の値が変わることの確認、色スタイルが実際に適用されていることの確認)
