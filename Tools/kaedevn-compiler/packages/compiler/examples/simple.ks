; Simple example scenario

*start
#ナレーター
ある日の午後。@l
公園のベンチに座っていると、声をかけられた。@p

#さくら
こんにちは！@l
今日はいい天気ですね。@p

; Show character sprite
@chara_show name=sakura storage=sakura_smile x=640 y=360

#主人公
（明るい子だな...）@l
@p

@jump target=choice1

*choice1
#ナレーター
どう返答する？@l

; TODO: Add choice command support in Phase 2

@jump target=good_ending

*good_ending
@bg storage=park_evening

#さくら
また会いましょうね！@l

@chara_hide name=sakura

#ナレーター
こうして、新しい友達ができた。@l
@p

; End of scenario
