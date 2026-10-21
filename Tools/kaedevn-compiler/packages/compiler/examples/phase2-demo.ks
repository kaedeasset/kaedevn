// Phase 2 Demo - 全コマンド対応

@bg room_day
@ch hero smile center

@bgm calm vol 70

主人公：良い朝だ。
今日は何をしようか。
@l

@wait 0.5

@se door
扉をノックする音が聞こえた。
@l

@ch heroine happy right fade 300
@bgm morning vol 80 fade 500

ヒロイン：おはよう！
@l

主人公：やあ、おはよう。
@p

// Scene change

@ch_hide hero fade 200
@ch_hide heroine fade 200
@bgm_stop fade 500

@wait 1

@bg library fade 500
@ch hero thinking center fade 300

主人公：図書館に来てみたものの…
@r
何を読もうか。
@l

@voice hero_001

主人公：この本にしよう。
@p

@ch_clear fade 500
おわり。
