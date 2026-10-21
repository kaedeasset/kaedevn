// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "KaedeUiPainter.h"        // FKaedeHit
#include "KaedePlaySession.h"      // FKaedePlaySession（KaedeVnCore）
#include "core/UiNode.hpp"         // kaedevn::ui::UiNode
#include "UObject/StrongObjectPtr.h"  // TStrongObjectPtr（RT とテクスチャをウィジェットの寿命で持つ）
#include "Engine/Texture2D.h"                // TStrongObjectPtr は完全な型を要る
#include "Engine/TextureRenderTarget2D.h"

#include <string>
#include <unordered_map>

namespace KaedeVn { struct FVnPaintContext; }   // OnPaint の各段が共有する描画の文脈（定義は .cpp）

// 案A 本体の Slate ウィジェット。FKaedePlaySession を毎フレーム駆動し、
// 現在の UiNode ツリーを OnPaint で FSlateDrawElement に発行、クリックを
// 「選択肢決定 or テキスト送り」へ振り分ける。論理 1920x1080 をレターボックス。
class KAEDEVNUI_API SKaedeMomijiUIWidget : public SCompoundWidget
{
public:
	// 既定は「全画面・論理1920x1080・タイトルから開始・シナリオはコマンドライン/マップ名で解決」。
	// 引数を与えると1プロセス内に複数インスタンスを並置できる（下部240px×4画面など）。
	SLATE_BEGIN_ARGS(SKaedeMomijiUIWidget)
		: _ScenarioName()
		, _LogicalW(1920)
		, _LogicalH(1080)
		, _FontSize(22)
		, _CompactLayout(false)
		, _SkipTitle(false)
		, _SaveProfile()
	{}
		// 再生するシナリオ（Game/ 相対。例 "scenario.json"）。空＝従来の解決（-KaedeProject/マップ名/projects.json）。
		SLATE_ARGUMENT(FString, ScenarioName)
		// 論理解像度。描画はこの座標系で組み、割り当て矩形へレターボックスで収める。
		SLATE_ARGUMENT(int32, LogicalW)
		SLATE_ARGUMENT(int32, LogicalH)
		// 既定の文字サイズ（論理px）。JSON で fontSize 指定のないノードに使う。
		SLATE_ARGUMENT(int32, FontSize)
		// 本文枠にストリップ用コンパクトテンプレートを使う（KaedeCore::BuildPlayTree の bCompact。
		// テンプレートは LogicalW x LogicalH で生成される）。
		SLATE_ARGUMENT(bool, CompactLayout)
		// タイトル/作品選択を出さず即本編へ入る（並置プレビュー用）。
		SLATE_ARGUMENT(bool, SkipTitle)
		// セーブ/設定ファイルの名前空間（例 "quad0"）。空＝従来の共有パス。
		// 複数インスタンスが同じ quick.json/slot_n.json を潰し合うのを防ぐ。
		SLATE_ARGUMENT(FString, SaveProfile)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	virtual void Tick(const FGeometry& AllottedGeometry, const double InCurrentTime,
		const float InDeltaTime) override;

	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry,
		const FSlateRect& MyCullingRect, FSlateWindowElementList& OutDrawElements,
		int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override;

	virtual FReply OnMouseButtonDown(const FGeometry& MyGeometry,
		const FPointerEvent& MouseEvent) override;

	// マウス移動で入力デバイスを MouseKeyboard に切替え、フォーカスリング/入力ガイドを消す
	//（Hover 主体へ。入力設計方針 §6/§14）。ドラッグ等は扱わないので Unhandled を返す。
	virtual FReply OnMouseMove(const FGeometry& MyGeometry,
		const FPointerEvent& MouseEvent) override;

	// Enhanced Input（AKaedePlayerController）から呼ばれる入力 API。マウスと同じ Session を駆動。
	// オーバーレイ/タイトル表示中は共有の純関数 KaedeUI::BuildFocusNav による方向フォーカスへ、
	// 本編中は従来どおり選択肢フォーカス/テキスト送りへ振り分ける。
	void InputConfirm();     // 決定 / テキスト送り / フォーカス中ボタンの実行
	void InputFocusNext();   // フォーカスを下へ（本編は選択肢フォーカス次へ）
	void InputFocusPrev();   // フォーカスを上へ（本編は選択肢フォーカス前へ）
	void InputFocusLeft();   // フォーカスを左へ（2Dレイアウト。スライダーは値を減らす）
	void InputFocusRight();  // フォーカスを右へ（2Dレイアウト。スライダーは値を増やす）
	void InputCancel();      // 戻る（オーバーレイを閉じる / 本編ならメニューを開く。ゲームパッド B）
	void InputAuto();        // オート再生 ON/OFF（本文を表示完了後に一定間隔で自動送り）
	void InputSkip();        // スキップ ON/OFF（本文を高速送り。選択肢では停止）
	void InputMenu();        // メニューを開く（本編中のみ。ゲームパッド Start）

	// 物理入力のデバイスを PlayerController から通知（Enhanced Input はデバイス非依存のため）。
	// キーボード/ゲームパッド操作 = フォーカスリング/入力ガイドを表示。bGamepad で入力ガイドの記号を切替。
	void NotifyInputDevice(bool bGamepad);

	// セーブ/ロード（F5 / F9）。ファイルは ProjectSaved/SaveGames/quick.json。ロードは本編の外ならシナリオを開始してから復元する。
	void QuickSave();
	void QuickLoad();

	// コンパクト（帯用テンプレート・論理W×H）⇔ 全画面（契約テンプレート）を実行時に切替。
	// セッション状態（進行/変数/タイプライター/セーブ）は保持され、描画テンプレートだけ差し替わる。
	// クアッド帯の「1枠を全画面へ展開 / 戻る」用。
	void SetCompactMode(bool bInCompact, int32 InLogicalW, int32 InLogicalH);

	// 論理解像度だけを差し替える（テンプレート種別は据え置き）。2解像度対応の本体。
	// 作品設定 screen{w,h} を反映する経路で、本文フォント既定サイズと SCREEN_FILTER の RT も
	// 追従して作り直す（RT を残すと旧解像度のまま背景が引き伸ばされるため）。
	// 設計: Docs/Reports/2026/07/25/02
	void SetLogicalSize(int32 InLogicalW, int32 InLogicalH);

	// 現在の論理解像度（ホスト側がウィンドウ実解像度を合わせるのに使う）。
	int32 GetLogicalW() const { return LogicalW; }
	int32 GetLogicalH() const { return LogicalH; }

	// 作品設定（scenario.json の "screen"）が指定する論理解像度。帯（コンパクト）表示中も
	// 保持しているので、1枠を全画面へ展開するときの寸法として使える。既定 1280x720。
	int32 GetScenarioScreenW() const { return ScenarioScreenW; }
	int32 GetScenarioScreenH() const { return ScenarioScreenH; }

private:
	// 説明書の絵を撮る試験（KaedeVnEditor の KaedeVnManualShotsTests.cpp。製品の zip には入らない）が、本編を進めて画面を開く
	friend struct FKaedeVnShotAccess;

	// セーブ先ディレクトリ。SaveProfile 指定時は SaveGames/<profile>/ へ隔離（並置インスタンス用）。
	// settings.json はユーザ全体の設定なので名前空間化せず共有のまま（SettingsPath 参照）。
	FString SaveDir() const;
	// クイックセーブのファイルパス。
	FString QuickSavePath() const;
	// 画面上部に短時間メッセージを出す（セーブ/ロード結果のフィードバック）。
	void ShowToast(const FString& Msg);

	// 画面モード（web版 TitleScreen/EndScreen をミラー）。
	// Select: 作品選択（projects.json が複数のとき）/ Title: タイトル画面 → クリックで開始 /
	// Playing: 本編 / End: シナリオ完了後のEND画面 → クリックでタイトル（or 作品選択）へ。
	enum class EScreen : uint8 { Select, Title, Playing, End };
	EScreen Screen = EScreen::Title;
	FString PendingScenarioJson;   // タイトルから開始/やり直すために保持するシナリオ JSON。空なら組み込みデモ。
	FString PendingTimelinesJson;  // TIMELINE_PLAY 用。シナリオと同じ dir の timelines.json。無いのが正常。
	FString WorkTitle;             // タイトル画面に出す作品名（シナリオ JSON の "title"）。
	int32   LastFaceIdx = -1;      // 3Dノベル: 最後に知らせた表情インデックス（読み進めた行数）。変化時だけ KaedeVn::OnExpressionRequest へ流す。
	void BeginScenario();          // タイトル/END から本編を開始（またはやり直す）。
	void ReturnToTitle();          // END からタイトル（複数作品なら作品選択）へ戻る。

	// 作品選択（projects.json）。UE 1 プロジェクトに複数の kaedevn 作品が同居できるため、
	// 起動時に一覧から選べるようにする。単一作品や -KaedeProject 指定時は選択を出さず従来どおり。
	struct FProjectItem { FString Id; FString Title; FString Scenario; };
	TArray<FProjectItem> Projects;   // projects.json 由来（無ければ空）
	int32   SelectedProject = 0;     // Select 画面のフォーカス位置（キーボード/ゲームパッド用）
	bool    bMultiProject = false;   // 作品が 2 件以上あり選択画面を使うか
	mutable TArray<KaedeUI::FKaedeHit> ProjectHits;  // Select 画面の各ボタンの当たり判定（論理座標・Projects と同じ index）。OnPaintで更新
	void LoadProjectsManifest();                 // Game/projects/projects.json を Projects へ（作品一覧を読むのはここだけ）
	FString ResolveProjectScenario() const;      // 単一作品のシナリオ名（-KaedeProject の作品 or 先頭。無ければ scenario.json）
	bool SelectProject(int32 Index);             // Projects[Index] のシナリオを読み込みタイトルへ。失敗で false
	void LoadScenarioIntoPending(const FString& ScenarioName);  // Game/<name> を PendingScenarioJson + WorkTitle へ

	FKaedePlaySession Session;
	kaedevn::ui::UiNode Tree;
	mutable TArray<KaedeUI::FKaedeHit> CachedHits;  // OnPaint で更新、クリック判定に使う

	// ===== 宣言的UI画面（Game/ui/*.json）: タイトル + オーバーレイ =====
	// タイトルは title.json があれば UiNode 描画（newgame/continue/goto:/quit ボタン）、
	// 無ければ従来の固定描画（クリックで開始）にフォールバックする。
	// オーバーレイはメニュー/設定/目次/セーブ/ロード/解説書を画面スタックで重ねる。
	kaedevn::ui::UiNode TitleTree;                     // title.json（pristine）
	bool bTitleTreeLoaded = false;
	mutable TArray<KaedeUI::FKaedeHit> TitleHits;      // OnPaint で更新

	FString OverlayName;                               // 現在のオーバーレイ画面名（空=非表示）
	// UI_SHOW でシナリオが開いた画面名（空=シナリオ由来の画面は出ていない）。
	// 閉じられたことを検出して Session.NotifyUiAction で返すために覚えておく。
	FString UiShowScreen;
	kaedevn::ui::UiNode OverlayTree;                   // 現在のオーバーレイ（pristine）
	TArray<FString> OverlayStack;                      // goto: の戻り先
	mutable TArray<KaedeUI::FKaedeHit> OverlayHits;    // OnPaint で更新

	// ===== Focus 一般化 / 入力デバイス（Phase 2-4 の VN 適用。CodexReports/2026/07/12-13）=====
	// オーバーレイ（メニュー/設定/セーブ/ロード/目次）とタイトルの action ボタンを、放置錬金と
	// 同じ共有の純関数 KaedeUI::BuildFocusNav で方向入力操作できるようにする。本編の選択肢は
	// 従来どおり Session 側フォーカス（GetFocusedChoice）で扱う（回帰回避）。
	// リング/入力ガイドは bFocusVisible（=キーボード/ゲームパッド操作中）のときだけ描くので、
	// マウス無操作の自動撮影 golden は不変（既存の非破壊検証を維持）。
	enum class EInputDevice : uint8 { MouseKeyboard, Gamepad };
	EInputDevice LastInputDevice = EInputDevice::MouseKeyboard;
	bool bFocusVisible = false;                        // gamepad/keyboard 操作中のみリング/ガイド表示

	// アクティブな focus 集合（overlay > title）を返す。無ければ nullptr（本編/選択肢/作品選択）。
	// OutKey にはアクティブ集合の識別子（変化で初期フォーカスへ戻す）を返す。
	TArray<KaedeUI::FKaedeHit>* ActiveFocusHits(FString& OutKey) const;
	void EnsureFocusContext() const;                   // アクティブ集合の nav 再構築・context 変化で初期化
	bool MoveVnFocus(int32 dx, int32 dy);              // アクティブ集合で方向移動/スライダー調整（context有=true）
	bool ConfirmVnFocus();                             // フォーカス中 hit の action を実行（実行/context有=true）
	mutable TArray<KaedeUI::FKaedeFocusNav> FocusNav;  // アクティブ集合の Focus Graph（同 index）
	mutable int32 FocusedHit = -1;                     // アクティブ集合内のフォーカス index
	mutable FString FocusContextKey;                   // アクティブ集合の識別（変化で FocusedHit を初期化）

	// ===== オート / スキップ（Phase 4 のプレイヤー向けアクション）=====
	// 本編中(Screen==Playing・オーバーレイ無し)のみ駆動。撮影(-KaedeVnShots)ではモード off なので golden 不変。
	void DriveAutoSkip(float DeltaSec);   // Tick からオート/スキップの自動送りを駆動
	bool  bAutoMode = false;
	bool  bSkipMode = false;
	float AutoAccum = 0.f;                // 表示完了後の経過秒（AutoDelaySec で自動送り）
	float SkipAccum = 0.f;                // スキップ送りのスロットル
	static constexpr float AutoDelaySec = 1.2f;   // 表示完了からこの秒数でオート送り
	static constexpr float SkipStepSec  = 0.04f;  // スキップ送りの最短間隔

	std::unordered_map<std::string, double> UiVars;    // bindVar の現在値（設定値。settings.json 永続化）
	kaedevn::ui::UiTheme UiThemeCurrent;               // uiTheme 設定から解決したテーマ（タイトル/オーバーレイ用）
	bool bHasQuickSave = false;                        // quick.json の有無（continue/quickload の enabled）
	TArray<bool> SlotExists;                           // slot_1..N.json の有無（load:n の enabled。N は KaedeVn::KaedeSaveSlotCount）

	bool LoadUiScreen(const FString& Name, kaedevn::ui::UiNode& Out) const;  // Game/ui/<Name>.json
	void RefreshTitleTree();                           // title.json 読込 + 作品名差し込み
	void OpenOverlay(const FString& Name);             // 現オーバーレイがあればスタックに積んで遷移
	void CloseOverlay();                               // スタックがあれば戻る、無ければ閉じる
	void HandleUiAction(const FString& Action, float RelX);  // 宣言的UIの action 分岐（結線本体）
	// 表示用ツリーを組む: pristine コピー → 変数反映 → 動的 enabled → prune。
	kaedevn::ui::UiNode BuildUiDisplayTree(const kaedevn::ui::UiNode& Pristine) const;
	void RefreshSaveFlags();                           // bHasQuickSave / SlotExists を再走査
	FString SlotSavePath(int32 Slot) const;            // Saved/SaveGames/slot_<n>.json
	bool SaveToSlot(int32 Slot);
	bool LoadFromSlot(int32 Slot);
	bool WriteSaveFile(const FString& Path);           // クイックセーブとスロットの共通（失敗の知らせ込み）
	bool ReadSaveFile(const FString& Path);            // クイックロードとスロットの共通（本編の外なら開始してから復元）
	// 設定（Saved/SaveGames/settings.json。フラットな name→数値）。
	FString SettingsPath() const;
	void LoadSettings();
	void SaveSettings() const;
	void ApplySettings();                              // msgSpeed→Session.SetTextSpeed / uiTheme→UiThemeCurrent
	// resolution（環境設定）/ 作品設定 screen → ウィンドウ実解像度（GameUserSettings）。
	// エディタ・帯ストリップ・-ResX/-ResY 起動では何もしない。
	void ApplyWindowResolution();
	// プレイヤーが環境設定で解像度を選んだことがあるか（settings.json に resolution がある）。
	// false の間は作品設定の解像度が既定になる。
	bool bUserResolutionSet = false;

	// トースト（一時メッセージ）。
	FString ToastMsg;
	float   ToastTimer = 0.0f;  // 秒。>0 の間だけ描画。

	// SCREEN_FILTER（.usf）適用: 背景テクスチャをフィルタして描く RT。ウィジェットが持つ（GC から守り、破棄で手放す）。
	TStrongObjectPtr<UTextureRenderTarget2D> FilterRT;
	TSharedPtr<FSlateBrush> FilterBrush;
	bool bFilterActive = false;

	// ===== UIスクショ自動撮影（非Shipping）=====
	// -KaedeVnShots=title,toc,config,menu,save,load,manual [-KaedeVnShotDir=<絶対パス>]
	// 入力もウィンドウフォーカスも使わず、Tick が画面を順に開いて FScreenshotRequest で
	// 撮影し終了する（-RenderOffscreen 併用可）。ユーザー操作中のPCを邪魔しない。
	TArray<FString> ShotQueue;
	int32 ShotIndex = -1;          // >=0 で撮影シーケンス駆動中
	float ShotTimer = 0.f;
	bool  bShotSetupDone = false;  // 土台画面（タイトル/本編）を用意した
	bool  bShotOverlayDone = false;// オーバーレイを開いた
	bool  bShotRequested = false;  // スクショ要求済み
	bool  bShotFocus = false;      // -KaedeVnFocus: 撮影時にフォーカスリング/入力ガイドを可視化（-KaedeIdleFocus の VN 版）
	bool  bShotAuto = false;       // -KaedeVnAuto: 本文シ撮影中にオート再生を強制（オート送りの入力レス検証）
	FString ShotOutDir;            // 出力先（未指定は Saved/Screenshots/VnUi）
	void TickShotSequence(float DeltaTime);

	// 検証/スクショ用の自動進行フラグ（コマンドライン）。
	bool bAutoToChoice = false;  // -KaedeToChoice: 選択肢が出るまで送る
	bool bToBranch = false;      // -KaedeToBranch: 選択肢で 0 を選び、分岐先テキストで止まる
	bool bToEnd = false;         // -KaedeToEnd: 選択肢 0 を選びつつ最後まで進める
	bool bDidSelect = false;     // bToBranch 用の内部状態
	bool bSaveDemo = false;      // -KaedeSaveDemo: 数行進めて自動クイックセーブ（トースト撮影用）
	float DemoTime = 0.0f;       // bSaveDemo の経過秒
	bool bDemoAdvanced = false;
	bool bDemoSaved = false;

	// 論理座標系（Construct の引数で決まる。既定 1920x1080）。
	// 元は static constexpr だったが、1プロセスに複数インスタンスを別解像度で並べるため
	// インスタンスメンバへ降格した。OnPaint 内の相対配置（LogicalH * 0.30f 等）はそのまま追従する。
	int32 LogicalW = 1920;
	int32 LogicalH = 1080;
	int32 LogicalFontSize = 22;
	// 1280x720 基準の本文フォントサイズ（Construct 引数の生値）。LogicalFontSize は
	// これに UiScale() を掛けた実効値で、解像度を変えるたび再計算される。
	int32 LogicalFontSizeBase = 22;
	// 作品設定（scenario.json の "screen"）の論理解像度。コンパクト表示でも保持する。
	int32 ScenarioScreenW = 1920;
	int32 ScenarioScreenH = 1080;

	// 1280x720 基準に対する論理キャンバスの倍率（1080p なら 1.5）。
	// 1280x720 基準で書かれた Game/ui/*.json と本文フォントを、解像度を変えても同じ
	// 見かけの大きさで出すための係数。コンパクト（帯）テンプレートは専用寸法で組まれて
	// いるので対象外＝常に 1.0。
	double UiScaleX() const { return bCompactLayout ? 1.0 : (double)LogicalW / 1280.0; }
	double UiScaleY() const { return bCompactLayout ? 1.0 : (double)LogicalH / 720.0; }

	// 3D ステージ（KaedeNovel/Tachie のレベル）か。2D の背景・立ち絵を描かず、表情の切り替えを知らせる。
	// Construct で 1 回だけ、GameViewport のワールド（PIE ならその PIE ワールド）のマップ名から決める。
	bool bThreeDStage = false;

	// 作品の絵（assets.json の id → 相対パス・テクスチャ・ブラシ）。LoadScenarioIntoPending で捨てて読み直す
	// ＝作品を切り替えたら前の作品の絵は出ない。テクスチャはウィジェットの寿命で持つ（root に残さない）。
	void ResetSceneAssets();
	UTexture2D* GetSceneTexture(const FString& Id) const;          // assets.json → Docs/png → 手続き生成
	UTexture* ResolveCameraTexture(const FString& Id) const;      // "camera:<Tag>" ならライブの RT
	UTexture* ResolveBackgroundTexture(const FString& Id) const;  // カメラ → PNG/手続き
	const FSlateBrush* GetSceneBrush(const FString& Id) const;
	TMap<FString, FString> AssetMap;
	mutable TMap<FString, TStrongObjectPtr<UTexture2D>> SceneTextures;
	mutable TMap<FString, TSharedPtr<FSlateBrush>> SceneBrushes;

	// ===== 描画（OnPaint を画面ごとに分けたもの。int32 を返すものは次の空き層を返す）=====
	int32 PaintSelectScreen(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;    // 作品選択
	int32 PaintTitleScreen(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;     // 宣言的タイトル（title.json）
	int32 PaintFallbackTitle(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;   // title.json 無しの固定タイトル
	int32 PaintPlayScreen(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;      // 本編と END
	void  PaintBackground(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	void  PaintBackgroundImage(const KaedeVn::FVnPaintContext& Ctx, int32 Layer, const FString& Id, float Alpha) const;
	void  PaintCharacters(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	int32 PaintSprites(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	void  PaintImageOverlays(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	void  PaintModeBadge(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	void  PaintEndScreen(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	int32 PaintOverlay(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	void  PaintFocusGuideToast(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	void  PaintFocusRing(const KaedeVn::FVnPaintContext& Ctx, const KaedeUI::FKaedeHit& Hit, int32 Layer) const;
	void  PaintInputGuide(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	void  PaintToast(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;
	void  PaintScreenEffects(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const;   // マスク・全画面エフェクト

	// SCREEN_FILTER の RT を破棄する（論理解像度が変わったら作り直すため）。
	void ReleaseFilterRT();
	bool  bCompactLayout = false;   // 本文枠にストリップ用テンプレート(論理W×H生成)を使う
	bool  bLoggedCompactMetrics = false;   // 初回配置の実測ログを1回だけ出すためのラッチ
	bool  bSkipTitle = false;       // タイトル/作品選択を出さず即本編へ
	FString SaveProfile;            // セーブ/設定の名前空間（空＝共有パス）
};
