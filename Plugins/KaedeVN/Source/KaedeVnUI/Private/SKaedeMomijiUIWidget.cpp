// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// SKaedeMomijiUIWidget.cpp — ノベル本編の画面そのもの。VN で一番大きいファイル。
//
// 背景・立ち絵・本文枠・選択肢・オーバーレイUI（メニュー/設定/セーブ…）・画面エフェクトを
// すべて1つの OnPaint で描く。進行は FKaedePlaySession（OpRunner + FKaedeOpHandler）が
// 持ち、ここは state を読んで描くのと、入力を Session へ返すのが仕事。
//
// 描画順（レイヤ）: 背景 → 立ち絵 → 画像オーバーレイ → 本文枠/選択肢 →
//                   オーバーレイUI → フォーカス/トースト → **全画面エフェクト**
// 全画面エフェクト（FLASH/FADE_*）は最前面。SHAKE だけは原点をずらす方式なので、
// エフェクト矩形はその影響を受けない位置に描く（揺らすと隙間が出る）。
//
// 論理座標の既定は 1920x1080。作品ごとにシナリオJSONの `screen` で 720p にもできる。
// `Game/ui/*.json` のオーバーレイは 1280x720 基準で書かれており、ScaleUiTree で
// 論理サイズへ合わせる（UiScaleX/Y）。**この二重基準がこのファイルの主な複雑さ。**
//
// 帯クアッド用の CompactLayout モードでは、本文枠に専用テンプレートを使い、
// 作品設定の解像度では動かさない（専用寸法で組まれているため）。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "SKaedeMomijiUIWidget.h"
#include "KaedeVnLog.h"
#include "KaedeVnSettings.h"   // KaedeVn::GetWorkRoot（作品の置き場）
#include "KaedeVnDraw.h"       // KaedeVn::DrawKaedeCmds / FKaedeLetterbox / MakeVnFont（3 つの画面で共通の描き方）
#include "KaedeVnLayout.h"     // KaedeVn::KaedeSaveSlotCount / CharPlacement / 文字の速さ

#include "KaedeUiPainter.h"
#include "SKaedeUiCanvas.h"      // GetKaedeRoundedFillBrush / GetKaedeRoundedOutlineBrush（角丸描画）
#include "MomijiUICore.h"   // LoadScreenTree / BuiltinTheme / PruneScreenTree（宣言的UI画面）
#include "Styling/CoreStyle.h"
#include "Fonts/FontMeasure.h"
#include "Fonts/CompositeFont.h"
#include "Framework/Application/SlateApplication.h"
#include "Rendering/DrawElements.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Engine/Texture2D.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"   // UWorld::GetMapName()（カメラ背景ステージ・3D ステージの判定）
#include "HAL/IConsoleManager.h"   // kaede.ForceScenario CVar（エディタのプレイ結線）
#include "Engine/Engine.h"          // GEngine / GetWorldContexts（PIE ワールド解決）
#include "GameFramework/GameUserSettings.h"  // ウィンドウ実解像度（720p/900p/1080p の適用）
#include "Engine/GameViewportClient.h"  // GameViewport->GetWorld()
#include "UnrealClient.h"               // FScreenshotRequest（UIスクショ自動撮影）
#include "KaedeVnExpression.h"            // 表情の切り替えを外へ知らせる受け口（受ける側は知らない）
#include "TextureResource.h"
#include "Styling/SlateBrush.h"
#include "ImageUtils.h"
#include "IImageWrapper.h"
#include "IImageWrapperModule.h"
#include "Modules/ModuleManager.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"   // IFileManager::MakeDirectory
#include "KaedeFilter.h"   // KaedeShaders::ApplyFilter
#include "KaedeSceneTextureProvider.h"  // ライブカメラ背景（camera:<Tag> → RenderTarget）
#include <nlohmann/json.hpp>  // assets.json パース

namespace
{
	// JSON の文字列を解く。壊れているときは false を返し、どこの何が壊れているかをログに出す。
	// このファイルの JSON の読み込みはすべてここ（とファイル版の ParseJsonFile）を通す（失敗を黙って捨てない）。
	bool ParseJsonText(const FString& Text, const FString& Source, nlohmann::json& OutJson)
	{
		try
		{
			OutJson = nlohmann::json::parse(TCHAR_TO_UTF8(*Text));
			return true;
		}
		catch (const nlohmann::json::exception& E)
		{
			UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] JSON を読めない: %s (%s)"), *Source, UTF8_TO_TCHAR(E.what()));
			return false;
		}
	}

	// JSON ファイルを読む。ファイルが無いときも false（無いのが正常なファイルがあるのでログは出さない）。
	bool ParseJsonFile(const FString& Path, nlohmann::json& OutJson)
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *Path)) return false;
		return ParseJsonText(Text, Path, OutJson);
	}

	// 3D ステージ等の判定に使う「実際に描画されているワールド」のマップ名。
	// Slate のコールバックから見たグローバルのワールドは PIE 中でもエディタ側を指すことがあるので使わない
	// （KaedeRuntime.cpp の ResolveGameWorld と同じ罠）。GameViewport → PIE/Game の WorldContext の順。
	FString ResolveGameMapName()
	{
		if (!GEngine) return FString();
		if (GEngine->GameViewport && GEngine->GameViewport->GetWorld())
			return GEngine->GameViewport->GetWorld()->GetMapName();
		for (const FWorldContext& Ctx : GEngine->GetWorldContexts())
		{
			if ((Ctx.WorldType == EWorldType::PIE || Ctx.WorldType == EWorldType::Game) && Ctx.World())
				return Ctx.World()->GetMapName();
		}
		return FString();
	}

	// エディタの「プレイ結線」用: 非空なら作品一覧・コマンドラインより優先して
	// この Game/相対シナリオを再生し、作品選択画面も飛ばす（SKaedeWorkEditor が設定）。
	static TAutoConsoleVariable<FString> CVarKaedeForceScenario(
		TEXT("kaede.ForceScenario"), TEXT(""),
		TEXT("非空なら指定した Game/相対シナリオJSONを強制再生（作品選択を飛ばす）。エディタのプレイ結線用。"),
		ECVF_Default);
}

namespace
{
	// 手続き生成の BGRA テクスチャ。アート素材が来るまでのプレースホルダ。
	// GC から守るのは受け取った側（ウィジェットの SceneTextures が TStrongObjectPtr で持つ）。
	UTexture2D* MakeTexture(int32 W, int32 H, const TArray<FColor>& Pixels)
	{
		UTexture2D* T = UTexture2D::CreateTransient(W, H, PF_B8G8R8A8);
		if (!T) return nullptr;
		T->SRGB = true;
		FTexture2DMipMap& Mip = T->GetPlatformData()->Mips[0];
		void* Data = Mip.BulkData.Lock(LOCK_READ_WRITE);
		FMemory::Memcpy(Data, Pixels.GetData(), W * H * sizeof(FColor));
		Mip.BulkData.Unlock();
		T->UpdateResource();
		return T;
	}

	// 縦グラデーション背景。
	UTexture2D* MakeBackgroundTexture(const FColor& Top, const FColor& Bottom)
	{
		const int32 W = 256, H = 256;
		TArray<FColor> Px; Px.SetNumUninitialized(W * H);
		for (int32 y = 0; y < H; ++y)
		{
			const float t = (float)y / (H - 1);
			const FColor C(
				(uint8)FMath::Lerp(Top.R, Bottom.R, t),
				(uint8)FMath::Lerp(Top.G, Bottom.G, t),
				(uint8)FMath::Lerp(Top.B, Bottom.B, t), 255);
			for (int32 x = 0; x < W; ++x) Px[y * W + x] = C;
		}
		return MakeTexture(W, H, Px);
	}

	// 立ち絵プレースホルダ（頭＋胴のシルエット）。
	UTexture2D* MakeCharacterTexture()
	{
		const int32 W = 400, H = 700;
		TArray<FColor> Px; Px.Init(FColor(0, 0, 0, 0), W * H);  // 透明
		const FColor Body(86, 196, 184, 235);   // やわらかいティール
		const float HeadCx = 200.f, HeadCy = 150.f, HeadR = 92.f;
		for (int32 y = 0; y < H; ++y)
		{
			for (int32 x = 0; x < W; ++x)
			{
				bool bIn = false;
				// 頭（円）
				const float dx = x - HeadCx, dy = y - HeadCy;
				if (dx * dx + dy * dy <= HeadR * HeadR) bIn = true;
				// 胴（上が細く下が広い台形）
				if (y >= 250)
				{
					const float t = (float)(y - 250) / (H - 250);
					const float halfW = FMath::Lerp(70.f, 165.f, t);
					if (FMath::Abs(x - 200.f) <= halfW) bIn = true;
				}
				if (bIn) Px[y * W + x] = Body;
			}
		}
		return MakeTexture(W, H, Px);
	}

	// PNG をデコードして UTexture2D を作る。bWhiteKey=true なら白背景を透過にする（立ち絵用）。
	UTexture2D* LoadPngTexture(const FString& Path, bool bWhiteKey)
	{
		TArray<uint8> Raw;
		if (!FFileHelper::LoadFileToArray(Raw, *Path)) return nullptr;

		IImageWrapperModule& Mod = FModuleManager::LoadModuleChecked<IImageWrapperModule>("ImageWrapper");
		TSharedPtr<IImageWrapper> Wrapper = Mod.CreateImageWrapper(EImageFormat::PNG);
		if (!Wrapper.IsValid() || !Wrapper->SetCompressed(Raw.GetData(), Raw.Num())) return nullptr;

		TArray64<uint8> BGRA;
		if (!Wrapper->GetRaw(ERGBFormat::BGRA, 8, BGRA)) return nullptr;
		const int32 W = Wrapper->GetWidth();
		const int32 H = Wrapper->GetHeight();

		TArray<FColor> Px; Px.SetNumUninitialized(W * H);
		for (int32 i = 0; i < W * H; ++i)
		{
			const uint8 B = BGRA[i * 4 + 0], G = BGRA[i * 4 + 1], R = BGRA[i * 4 + 2], A = BGRA[i * 4 + 3];
			uint8 OutA = A;
			if (bWhiteKey && R >= 244 && G >= 244 && B >= 244) OutA = 0;  // 白背景を透過
			Px[i] = FColor(R, G, B, OutA);
		}
		return MakeTexture(W, H, Px);
	}

	// SCREEN_FILTER 名 → .usf の FilterType。0=none/1=grayscale/2=sepia/3=warm/4=cool。
	int32 MapFilterType(const FString& Name)
	{
		if (Name.Equals(TEXT("grayscale"), ESearchCase::IgnoreCase) || Name.Equals(TEXT("mono"), ESearchCase::IgnoreCase)) return 1;
		if (Name.Equals(TEXT("sepia"), ESearchCase::IgnoreCase)) return 2;
		if (Name.Equals(TEXT("warm"), ESearchCase::IgnoreCase) || Name.Equals(TEXT("morning"), ESearchCase::IgnoreCase)) return 3;
		if (Name.Equals(TEXT("cool"), ESearchCase::IgnoreCase) || Name.Equals(TEXT("night"), ESearchCase::IgnoreCase)) return 4;
		return 0;
	}
}

// ===== 作品の絵（assets.json・テクスチャ・ブラシ）=====

void SKaedeMomijiUIWidget::ResetSceneAssets()
{
	SceneBrushes.Reset();
	SceneTextures.Reset();
	AssetMap.Reset();
	// プロジェクトの assets.json（asset id → ProjectDir 相対パス）。
	nlohmann::json J;
	if (!ParseJsonFile(KaedeVn::GetWorkRoot() / TEXT("assets.json"), J) || !J.is_object()) return;
	for (auto It = J.begin(); It != J.end(); ++It)
	{
		if (It.value().is_string())
			AssetMap.Add(UTF8_TO_TCHAR(It.key().c_str()),
			             UTF8_TO_TCHAR(It.value().get<std::string>().c_str()));
	}
}

// id → テクスチャ（キャッシュ）。
// まず assets.json で解決 → Docs/png/<id>.png → 手続き生成。
UTexture2D* SKaedeMomijiUIWidget::GetSceneTexture(const FString& Id) const
{
	if (const TStrongObjectPtr<UTexture2D>* Found = SceneTextures.Find(Id)) return Found->Get();

	UTexture2D* T = nullptr;

	// bg/ch の判定は assets.json の相対パス接頭(bg/ ch/)で行う（ULID id でも確実に分類）。
	// 未解決のときだけ id 文字列ヒューリスティックにフォールバック。
	bool bIsChar = !Id.Contains(TEXT("bg"));
	FString File;
	if (const FString* Rel = AssetMap.Find(Id))
	{
		File = FPaths::ProjectDir() / *Rel;            // assets.json で解決
		if (Rel->StartsWith(TEXT("ch/")) || Rel->Contains(TEXT("/ch/")))      bIsChar = true;
		else                                                                  bIsChar = false;  // bg/ や title/ は背景扱い(白抜きしない)
	}
	if (File.IsEmpty() || !FPaths::FileExists(File))
	{
		File = FPaths::ProjectDir() / TEXT("Docs") / TEXT("png") / (Id + TEXT(".png"));  // フォールバック
	}
	if (FPaths::FileExists(File))
	{
		T = LoadPngTexture(File, /*bWhiteKey*/ bIsChar);
	}

	if (!T)  // 最終フォールバック: 手続き生成
	{
		if (Id.Contains(TEXT("night")))   T = MakeBackgroundTexture(FColor(10, 12, 40, 255),  FColor(44, 32, 72, 255));
		else if (!bIsChar)                T = MakeBackgroundTexture(FColor(40, 36, 78, 255),  FColor(214, 130, 96, 255));
		else                              T = MakeCharacterTexture();
	}
	SceneTextures.Add(Id, TStrongObjectPtr<UTexture2D>(T));
	return T;
}

// 背景 id が assets.json で "camera:<Tag>" を指すなら、登録済み provider（kaedevn の
// SceneCapture）からライブな RenderTarget を得る。指していない/未解決なら nullptr。
UTexture* SKaedeMomijiUIWidget::ResolveCameraTexture(const FString& Id) const
{
	if (const FString* Rel = AssetMap.Find(Id))
	{
		static const FString CamPrefix = TEXT("camera:");
		if (Rel->StartsWith(CamPrefix))
			return KaedeUI::ResolveSceneTexture(Rel->RightChop(CamPrefix.Len()));
	}
	return nullptr;
}

// 背景/フィルタ用の最終解決: まずライブカメラ（RT）、無ければ従来の PNG/手続き（UTexture2D）。
UTexture* SKaedeMomijiUIWidget::ResolveBackgroundTexture(const FString& Id) const
{
	if (UTexture* Live = ResolveCameraTexture(Id)) return Live;
	return GetSceneTexture(Id);
}

// id → FSlateBrush（キャッシュ）。RenderTarget も UObject 同一なのでキャッシュ可。
const FSlateBrush* SKaedeMomijiUIWidget::GetSceneBrush(const FString& Id) const
{
	if (const TSharedPtr<FSlateBrush>* Found = SceneBrushes.Find(Id)) return Found->Get();
	UTexture* T = ResolveBackgroundTexture(Id);
	if (!T) return nullptr;
	TSharedPtr<FSlateBrush> B = MakeShared<FSlateBrush>();
	B->SetResourceObject(T);
	B->ImageSize = FVector2D(T->GetSurfaceWidth(), T->GetSurfaceHeight());
	B->DrawAs = ESlateBrushDrawType::Image;
	SceneBrushes.Add(Id, B);
	return B.Get();
}

void SKaedeMomijiUIWidget::ReleaseFilterRT()
{
	FilterRT.Reset();
	FilterBrush.Reset();
	bFilterActive = false;
}

void SKaedeMomijiUIWidget::SetCompactMode(bool bInCompact, int32 InLogicalW, int32 InLogicalH)
{
	bCompactLayout = bInCompact;
	LogicalW = FMath::Max(1, InLogicalW);
	LogicalH = FMath::Max(1, InLogicalH);
	LogicalFontSize = FMath::Max(1, FMath::RoundToInt(LogicalFontSizeBase * UiScaleX()));
	Session.SetCompactLayout(bCompactLayout, LogicalW, LogicalH);
	ReleaseFilterRT();   // 旧論理サイズの RT が残ると背景が引き伸ばされる
	Invalidate(EInvalidateWidgetReason::Paint);
}

void SKaedeMomijiUIWidget::SetLogicalSize(int32 InLogicalW, int32 InLogicalH)
{
	const int32 W = FMath::Max(1, InLogicalW);
	const int32 H = FMath::Max(1, InLogicalH);
	if (W == LogicalW && H == LogicalH) return;
	SetCompactMode(bCompactLayout, W, H);
	UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] logical canvas = %dx%d (font %d)"),
		LogicalW, LogicalH, LogicalFontSize);
}

void SKaedeMomijiUIWidget::Construct(const FArguments& InArgs)
{
	SetVisibility(EVisibility::Visible);  // 画面全体でクリックを受ける
	SetCanTick(true);

	// 並置インスタンス用の引数（既定は従来の全画面1280x720・共有セーブ・タイトルから開始）。
	LogicalW       = FMath::Max(1, InArgs._LogicalW);
	LogicalH       = FMath::Max(1, InArgs._LogicalH);
	LogicalFontSizeBase = FMath::Max(1, InArgs._FontSize);
	bCompactLayout = InArgs._CompactLayout;
	bSkipTitle     = InArgs._SkipTitle;
	SaveProfile    = InArgs._SaveProfile;
	// 本文フォントは 1280 基準の指定値 × 論理キャンバス倍率（1080p なら 22→33）。
	LogicalFontSize = FMath::Max(1, FMath::RoundToInt(LogicalFontSizeBase * UiScaleX()));
	Session.SetCompactLayout(bCompactLayout, LogicalW, LogicalH);

	bAutoToChoice = FParse::Param(FCommandLine::Get(), TEXT("KaedeToChoice"));
	bToBranch     = FParse::Param(FCommandLine::Get(), TEXT("KaedeToBranch"));
	bToEnd        = FParse::Param(FCommandLine::Get(), TEXT("KaedeToEnd"));
	bSaveDemo     = FParse::Param(FCommandLine::Get(), TEXT("KaedeSaveDemo"));

#if !UE_BUILD_SHIPPING
	// UIスクショ自動撮影（入力不要・オフスクリーン可）。詳細はヘッダ参照。
	{
		FString ShotsArg;
		// bShouldStopOnSeparator=false: 既定 true だとカンマで切られ先頭要素しか取れない。
		if (FParse::Value(FCommandLine::Get(), TEXT("KaedeVnShots="), ShotsArg, false) && !ShotsArg.IsEmpty())
		{
			ShotsArg.ParseIntoArray(ShotQueue, TEXT(","), true);
			FParse::Value(FCommandLine::Get(), TEXT("KaedeVnShotDir="), ShotOutDir);
			bShotFocus = FParse::Param(FCommandLine::Get(), TEXT("KaedeVnFocus"));
			bShotAuto  = FParse::Param(FCommandLine::Get(), TEXT("KaedeVnAuto"));
			if (ShotQueue.Num() > 0) ShotIndex = 0;
		}
	}
#endif

	// 作品の絵の対応表（assets.json）。作品を選んだら LoadScenarioIntoPending で読み直す。
	ResetSceneAssets();

	// プロジェクトのシナリオ JSON を読み込んで保持する（本編開始はタイトル画面のクリック後）。
	// カメラ背景シナリオ(scenario_cam.json)を使う条件:
	//   1) -KaedeCamDemo フラグ（従来どおり）
	//   2) カメラ背景ステージ KaedeStage が開かれている。PIE ではマップ名が "UEDPIE_0_KaedeStage" 等。
	const bool bCamDemoFlag = FParse::Param(FCommandLine::Get(), TEXT("KaedeCamDemo"));
	const FString MapName = ResolveGameMapName();
	const bool bCamStage = MapName.Contains(TEXT("KaedeStage"));
	bThreeDStage = MapName.Contains(TEXT("KaedeNovel")) || MapName.Contains(TEXT("Tachie"));
	const bool bCamDemo = bCamDemoFlag || bCamStage;

	// 作品一覧（Game/projects/ のマニフェスト）を読み込む。UE 1 プロジェクトに複数の kaedevn 作品が同居できる。
	LoadProjectsManifest();

	FString ForcedId;
	const bool bForced = FParse::Value(FCommandLine::Get(), TEXT("KaedeProject="), ForcedId) && !ForcedId.IsEmpty();
	const bool bAutoFlags = bAutoToChoice || bToBranch || bToEnd || bSaveDemo;

	// 作品選択画面を出す条件: 2D 通常起動 かつ 作品が2件以上 かつ -KaedeProject 未指定 かつ
	// 自動進行/スクショ撮影でない。
	bMultiProject = (Projects.Num() >= 2);
	// ScenarioName を明示指定された並置インスタンスは作品選択を出さない（各枠の作品は呼び出し側が決める）。
	const bool bScenarioForced = !InArgs._ScenarioName.IsEmpty();
	// エディタのプレイ結線: kaede.ForceScenario が非空なら最優先で単一作品として再生する。
	const FString ForceScenarioCVar = CVarKaedeForceScenario.GetValueOnGameThread();
	const bool bForceScenarioCVar = !ForceScenarioCVar.IsEmpty();
	const bool bShowSelect = !bThreeDStage && !bCamDemo && bMultiProject && !bForced && !bAutoFlags
	                         && !bScenarioForced && !bForceScenarioCVar && !bSkipTitle && ShotIndex < 0;

	if (!bShowSelect)
	{
		// 単一作品パス: ForceScenario(CVar) > 引数指定 > 3D/カメラ上書き > 作品一覧（-KaedeProject or 先頭）> scenario.json。
		FString ScenarioName = ResolveProjectScenario();
		if (bForceScenarioCVar)   ScenarioName = ForceScenarioCVar;
		else if (bScenarioForced) ScenarioName = InArgs._ScenarioName;
		else if (bThreeDStage) ScenarioName = TEXT("scenario_3d.json");
		else if (bCamDemo)   ScenarioName = TEXT("scenario_cam.json");
		LoadScenarioIntoPending(ScenarioName);
		// ワンショット消費: 次回の通常起動に持ち越さないよう読んだら空へ戻す。
		if (bForceScenarioCVar) CVarKaedeForceScenario->Set(TEXT(""), ECVF_SetByCode);
	}

	// 設定（settings.json）を読み込み、config.json の既定値で不足キーを補い、実効きさせる。
	{
		LoadSettings();
		kaedevn::ui::UiNode ConfigTree;
		if (LoadUiScreen(TEXT("config"), ConfigTree))
			KaedeUI::SeedVarsFromTree(ConfigTree, UiVars);
		ApplySettings();
	}
	RefreshSaveFlags();
	RefreshTitleTree();

	// 検証/スクショ用の自動進行フラグ、または SkipTitle 指定ならタイトルを飛ばして即開始。
	if (bAutoFlags || bSkipTitle)
	{
		BeginScenario();
	}
	else if (bShowSelect)
	{
		Screen = EScreen::Select;
		SelectedProject = 0;
		Tree = Session.CurrentTree();
	}
	else
	{
		Screen = EScreen::Title;
		Tree = Session.CurrentTree();
	}
}

// ===== 宣言的UI画面（Game/ui/*.json）の読み込みと状態バインド =====

bool SKaedeMomijiUIWidget::LoadUiScreen(const FString& Name, kaedevn::ui::UiNode& Out) const
{
	const FString Path = KaedeVn::GetWorkRoot() / TEXT("ui") / (Name + TEXT(".json"));
	FString Json;
	if (!FFileHelper::LoadFileToString(Json, *Path)) return false;
	Out = KaedeCore::LoadScreenTree(TCHAR_TO_UTF8(*Json));
	return !Out.children.empty() || Out.type != kaedevn::ui::UiType::Panel;
}

// title.json を読み、logo フォントの Label に作品名（シナリオ JSON の title）を差し込む。
void SKaedeMomijiUIWidget::RefreshTitleTree()
{
	bTitleTreeLoaded = LoadUiScreen(TEXT("title"), TitleTree);
	if (!bTitleTreeLoaded || WorkTitle.IsEmpty()) return;
	// 最初の logo Label = 作品タイトル表示（title.json のプレースホルダを実作品名で上書き）。
	TFunction<bool(kaedevn::ui::UiNode&)> Visit = [&](kaedevn::ui::UiNode& N) -> bool
	{
		if (N.type == kaedevn::ui::UiType::Label && N.font == "logo")
		{
			N.text = TCHAR_TO_UTF8(*WorkTitle);
			return true;
		}
		for (auto& C : N.children) if (Visit(C)) return true;
		return false;
	};
	Visit(TitleTree);
}

void SKaedeMomijiUIWidget::OpenOverlay(const FString& Name)
{
	kaedevn::ui::UiNode NewTree;
	if (!LoadUiScreen(Name, NewTree))
	{
		ShowToast(FString::Printf(TEXT("画面がありません: %s.json"), *Name));
		return;
	}
	if (!OverlayName.IsEmpty()) OverlayStack.Push(OverlayName);
	OverlayName = Name;
	OverlayTree = MoveTemp(NewTree);
	KaedeUI::SeedVarsFromTree(OverlayTree, UiVars);  // 新画面の既定値で不足キーを補う
	RefreshSaveFlags();                              // セーブ/ロード系の enabled を最新化
}

void SKaedeMomijiUIWidget::CloseOverlay()
{
	if (OverlayStack.Num() > 0)
	{
		const FString Back = OverlayStack.Pop();
		kaedevn::ui::UiNode BackTree;
		if (LoadUiScreen(Back, BackTree))
		{
			OverlayName = Back;
			OverlayTree = MoveTemp(BackTree);
			return;
		}
	}
	OverlayName.Reset();
	OverlayStack.Reset();
	OverlayHits.Reset();
}

// 表示用ツリー: pristine コピー → 変数反映 → 動的 enabled（セーブ有無）→ 条件 prune。
kaedevn::ui::UiNode SKaedeMomijiUIWidget::BuildUiDisplayTree(const kaedevn::ui::UiNode& Pristine) const
{
	kaedevn::ui::UiNode T = Pristine;
	KaedeUI::ApplyVarsToTree(T, UiVars);

	KaedeUI::SetActionEnabled(T, TEXT("continue"), bHasQuickSave);
	KaedeUI::SetActionEnabled(T, TEXT("quickload"), bHasQuickSave);
	for (int32 i = 0; i < SlotExists.Num(); ++i)
		KaedeUI::SetActionEnabled(T, FString::Printf(TEXT("load:%d"), i + 1), SlotExists[i]);

	std::unordered_map<std::string, double> CondVars = UiVars;
#if PLATFORM_ANDROID
	CondVars["touch"] = 1.0;
#else
	CondVars["touch"] = 0.0;
#endif
	KaedeCore::PruneScreenTree(T, CondVars);

	// Game/ui/*.json は 1280x720 基準で書かれている。論理キャンバスが 1920x1080 のときは
	// 寸法を 1.5 倍して「同じ見かけの大きさ」で出す（解像度別 JSON の二重管理を避けるため）。
	// anchor/flex/center による相対配置はキャンバス側が解決するので触らない。
	KaedeCore::ScaleUiTree(T, UiScaleX(), UiScaleY());
	return T;
}

void SKaedeMomijiUIWidget::RefreshSaveFlags()
{
	bHasQuickSave = FPaths::FileExists(QuickSavePath());
	SlotExists.SetNum(KaedeVn::KaedeSaveSlotCount);
	for (int32 i = 0; i < KaedeVn::KaedeSaveSlotCount; ++i)
		SlotExists[i] = FPaths::FileExists(SlotSavePath(i + 1));
}

FString SKaedeMomijiUIWidget::SlotSavePath(int32 Slot) const
{
	// SaveProfile 指定時は SaveGames/<profile>/ 配下へ隔離する。並置インスタンスが
	// 同じ slot_n.json を互いに上書きしないようにするため（空＝従来の共有パス）。
	return SaveDir() / FString::Printf(TEXT("slot_%d.json"), Slot);
}

FString SKaedeMomijiUIWidget::SaveDir() const
{
	const FString Base = FPaths::ProjectSavedDir() / TEXT("SaveGames");
	return SaveProfile.IsEmpty() ? Base : (Base / SaveProfile);
}

FString SKaedeMomijiUIWidget::QuickSavePath() const
{
	return SaveDir() / TEXT("quick.json");
}

// セーブを書き出す（クイックセーブとスロットの共通）。書けない場面・書き損じはここで知らせる。
// 成功の知らせ（どこへ書いたか）は呼び出し側。
bool SKaedeMomijiUIWidget::WriteSaveFile(const FString& Path)
{
	if (Screen != EScreen::Playing || !Session.CanSave())
	{
		ShowToast(TEXT("ここではセーブできません"));
		return false;
	}
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path), /*Tree*/ true);
	const FString Content = UTF8_TO_TCHAR(Session.SaveToJson().c_str());
	if (!FFileHelper::SaveStringToFile(Content, *Path, FFileHelper::EEncodingOptions::ForceUTF8))
	{
		ShowToast(TEXT("セーブに失敗しました"));
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] save failed: %s"), *Path);
		return false;
	}
	UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] saved: %s"), *Path);
	RefreshSaveFlags();   // つづきから・クイックロード・load:<n> を即時有効化
	return true;
}

// セーブを読み込む（クイックロードとスロットの共通）。タイトル等の本編の外から読むときは
// シナリオを開始してから復元する。無い・壊れているときはここで知らせる。成功の知らせは呼び出し側。
bool SKaedeMomijiUIWidget::ReadSaveFile(const FString& Path)
{
	// 作品選択ではどの作品を始めるか決まっていないので読まない（作品を選んでから）。
	if (Screen == EScreen::Select)
	{
		ShowToast(TEXT("ここではロードできません"));
		return false;
	}
	FString Content;
	if (!FFileHelper::LoadFileToString(Content, *Path))
	{
		ShowToast(TEXT("セーブデータがありません"));
		return false;
	}
	if (Screen != EScreen::Playing) BeginScenario();
	if (!Session.LoadFromJson(TCHAR_TO_UTF8(*Content)))
	{
		ShowToast(TEXT("ロードに失敗しました"));
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] load failed: %s"), *Path);
		return false;
	}
	Tree = Session.CurrentTree();
	bFilterActive = false;  // フィルターは次フレームの Tick で再評価する
	UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] loaded: %s"), *Path);
	return true;
}

void SKaedeMomijiUIWidget::QuickSave()
{
	if (WriteSaveFile(QuickSavePath())) ShowToast(TEXT("クイックセーブしました"));
}

void SKaedeMomijiUIWidget::QuickLoad()
{
	if (ReadSaveFile(QuickSavePath())) ShowToast(TEXT("クイックロードしました"));
}

bool SKaedeMomijiUIWidget::SaveToSlot(int32 Slot)
{
	if (Slot < 1 || Slot > KaedeVn::KaedeSaveSlotCount)
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] save: のスロット番号が範囲外: %d（1..%d）"), Slot, KaedeVn::KaedeSaveSlotCount);
		ShowToast(TEXT("セーブに失敗しました"));
		return false;
	}
	if (!WriteSaveFile(SlotSavePath(Slot))) return false;
	ShowToast(FString::Printf(TEXT("スロット%dにセーブしました"), Slot));
	return true;
}

bool SKaedeMomijiUIWidget::LoadFromSlot(int32 Slot)
{
	if (Slot < 1 || Slot > KaedeVn::KaedeSaveSlotCount)
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] load: のスロット番号が範囲外: %d（1..%d）"), Slot, KaedeVn::KaedeSaveSlotCount);
		ShowToast(TEXT("ロードに失敗しました"));
		return false;
	}
	if (!ReadSaveFile(SlotSavePath(Slot))) return false;
	ShowToast(FString::Printf(TEXT("スロット%dをロードしました"), Slot));
	return true;
}

// ===== 設定の永続化と実効き =====

FString SKaedeMomijiUIWidget::SettingsPath() const
{
	return FPaths::ProjectSavedDir() / TEXT("SaveGames") / TEXT("settings.json");
}

void SKaedeMomijiUIWidget::LoadSettings()
{
	nlohmann::json J;
	if (!ParseJsonFile(SettingsPath(), J) || !J.is_object()) return;
	for (auto It = J.begin(); It != J.end(); ++It)
		if (It.value().is_number()) UiVars[It.key()] = It.value().get<double>();
	// プレイヤーが環境設定で解像度を選んだことがあるか。config.json の静的既定
	//（SeedVarsFromTree が後から埋める値）と区別するため、ファイル側の有無で判定する。
	// 未選択なら作品設定（scenario.json の "screen"）の解像度が既定になる。
	bUserResolutionSet = J.contains("resolution") && J["resolution"].is_number();
}

void SKaedeMomijiUIWidget::SaveSettings() const
{
	nlohmann::json J = nlohmann::json::object();
	for (const auto& Kv : UiVars) J[Kv.first] = Kv.second;
	const FString Path = SettingsPath();
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path), /*Tree*/ true);
	if (!FFileHelper::SaveStringToFile(UTF8_TO_TCHAR(J.dump(2).c_str()), *Path,
	                                   FFileHelper::EEncodingOptions::ForceUTF8))
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] 設定を保存できない: %s"), *Path);
	}
}

void SKaedeMomijiUIWidget::ApplySettings()
{
	// メッセージ速度: msgSpeed(0..1) → バイト/秒。未設定は既定の KaedeDefaultTextSpeed（≒20字/秒）になる値。
	const auto It = UiVars.find("msgSpeed");
	const double MsgSpeed = (It != UiVars.end()) ? It->second
		: KaedeVn::KaedeDefaultTextSpeed / KaedeVn::KaedeTextSpeedPerMsgSpeed;
	Session.SetTextSpeed((float)FMath::Clamp(MsgSpeed * KaedeVn::KaedeTextSpeedPerMsgSpeed, 15.0, 300.0));

	// テーマ: uiTheme(0/1/2) → atelier/midnight/sakura（タイトル/オーバーレイの描画に使用）。
	const auto Th = UiVars.find("uiTheme");
	const int32 Idx = (Th != UiVars.end()) ? (int32)FMath::RoundToInt(Th->second) : 0;
	const char* Name = (Idx == 1) ? "midnight" : (Idx == 2) ? "sakura" : "atelier";
	UiThemeCurrent = KaedeCore::BuiltinTheme(Name);

	// 書体: fontFace(0=ゴシック / 1=明朝)。キーが無い既存 settings.json は 0＝従来どおり。
	// 放置錬金は対象外で常にゴシック（MakeKaedeUiFont の既定引数）。
	const auto Ff = UiVars.find("fontFace");
	const int32 FaceIdx = (Ff != UiVars.end()) ? (int32)FMath::RoundToInt(Ff->second) : 0;
	KaedeVn::SetVnFontFamily(FaceIdx == 1 ? KaedeUI::EKaedeFontFamily::Mincho
	                                       : KaedeUI::EKaedeFontFamily::Gothic);

	ApplyWindowResolution();
}

// 環境設定 resolution（config.json の 720p/900p/1080p トグル）と作品設定 screen を
// ウィンドウ実解像度へ反映する（PC リリース向け。設計 Docs/Reports/2026/07/25/02）。
//
// 適用しない条件（いずれも「頼まれていない窓の変更をしない」ため）:
//   - エディタ / PIE          … 作業中のエディタウィンドウを動かさない
//   - 帯ストリップ表示中      … 1920x240 の帯窓を壊さない
//   - -ResX / -ResY 指定起動  … 検証スクリプトや帯ランチャの指定を最優先する
void SKaedeMomijiUIWidget::ApplyWindowResolution()
{
	if (GIsEditor || bCompactLayout) return;
	int32 CmdRes = 0;
	if (FParse::Value(FCommandLine::Get(), TEXT("ResX="), CmdRes)
		|| FParse::Value(FCommandLine::Get(), TEXT("ResY="), CmdRes)) return;

	UGameUserSettings* Settings = GEngine ? GEngine->GetGameUserSettings() : nullptr;
	if (!Settings) return;

	// resolution: 0=720p / 1=900p / 2=1080p（config.json のトグルと同じ並び）。
	// プレイヤー未選択なら作品設定の解像度を既定にする（作品設定 < ユーザ設定）。
	static const FIntPoint Presets[3] = { FIntPoint(1280, 720), FIntPoint(1600, 900), FIntPoint(1920, 1080) };
	int32 PresetIdx = ScenarioScreenH >= 1080 ? 2 : 0;
	if (bUserResolutionSet)
	{
		const auto It = UiVars.find("resolution");
		if (It != UiVars.end()) PresetIdx = FMath::RoundToInt(It->second);
	}
	PresetIdx = FMath::Clamp(PresetIdx, 0, 2);

	const FIntPoint Target = Presets[PresetIdx];
	if (Settings->GetScreenResolution() == Target) return;
	Settings->SetScreenResolution(Target);
	Settings->ApplyResolutionSettings(/*bCheckForCommandLineOverrides*/ false);
	Settings->SaveSettings();
	UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] window resolution -> %dx%d (%s)"),
		Target.X, Target.Y, bUserResolutionSet ? TEXT("環境設定") : TEXT("作品設定"));
}

// 宣言的UIの action 分岐（結線本体）。プレビュー(SKaedeMomijiUIPreview)と同じ規約:
//   set:/slider:/toggle: … 設定値の変更（settings.json へ保存し即時実効き）
//   goto:<screen> / close … オーバーレイ遷移
//   newgame / continue / quit / quicksave / quickload / save:<n> / load:<n> /
//   jump:start / goto:title … ゲーム遷移
void SKaedeMomijiUIWidget::HandleUiAction(const FString& Action, float RelX)
{
	// set:/slider:/toggle:/reset は ADV の外殻と同じ 1 本（KaedeUI::ApplyShellVarAction）。reset は現オーバーレイ（設定画面想定）の既定値へ
	FString VarName;
	const KaedeUI::EKaedeVarAction VarKind = KaedeUI::ApplyShellVarAction(Action, RelX, OverlayTree, UiVars, &VarName);
	if (VarKind != KaedeUI::EKaedeVarAction::None)
	{
		// 解像度はここで初めて「プレイヤーが選んだ」状態になる（以後は作品設定より優先）。
		if (VarKind == KaedeUI::EKaedeVarAction::Set && VarName == TEXT("resolution")) bUserResolutionSet = true;
		ApplySettings();
		SaveSettings();
		return;
	}
	if (Action.StartsWith(TEXT("set:"))) return;   // 形の違う set:（= が無い）は従来どおり何もしない
	if (Action.StartsWith(TEXT("goto:")))
	{
		const FString Name = Action.Mid(5);
		if (Name == TEXT("title"))
		{
			// 本編からタイトルへ（オーバーレイは全部閉じる）。
			OverlayName.Reset(); OverlayStack.Reset(); OverlayHits.Reset();
			RefreshTitleTree();
			ReturnToTitle();
			return;
		}
		OpenOverlay(Name);
		return;
	}
	if (Action == TEXT("close")) { CloseOverlay(); return; }
	if (Action == TEXT("newgame"))
	{
		OverlayName.Reset(); OverlayStack.Reset();
		BeginScenario();
		return;
	}
	if (Action == TEXT("continue"))
	{
		if (!bHasQuickSave) { ShowToast(TEXT("セーブデータがありません")); return; }
		OverlayName.Reset(); OverlayStack.Reset();
		QuickLoad();   // 本編の外からなのでシナリオを開始してから復元する（ReadSaveFile）
		return;
	}
	if (Action == TEXT("quit"))
	{
		if (GEngine && GEngine->GameViewport)
			GEngine->GameViewport->ConsoleCommand(TEXT("quit"));  // PIE では PIE 終了
		return;
	}
	if (Action == TEXT("quicksave")) { QuickSave(); return; }
	if (Action == TEXT("quickload"))
	{
		if (!bHasQuickSave) { ShowToast(TEXT("セーブデータがありません")); return; }
		OverlayName.Reset(); OverlayStack.Reset();
		QuickLoad();
		return;
	}
	if (Action.StartsWith(TEXT("save:")))
	{
		SaveToSlot(FCString::Atoi(*Action.Mid(5)));  // 結果はトーストで通知（画面は開いたまま）
		return;
	}
	if (Action.StartsWith(TEXT("load:")))
	{
		if (LoadFromSlot(FCString::Atoi(*Action.Mid(5))))
		{
			OverlayName.Reset(); OverlayStack.Reset();
		}
		return;
	}
	if (Action == TEXT("jump:start"))
	{
		// 目次「はじめから」= 最初からやり直し。
		OverlayName.Reset(); OverlayStack.Reset();
		BeginScenario();
		return;
	}
	if (Action.StartsWith(TEXT("jump:")))
	{
		ShowToast(TEXT("章ジャンプは未対応です（章データ未実装）"));
		return;
	}
	UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn-ui] unhandled action: %s"), *Action);
}

// 作品一覧（Game/projects/ のマニフェスト）を読み、ノベルの作品 {id,title,scenario} を Projects へ。無ければ空のまま。
// 作品一覧を読むのはここだけ（作品選択も単一作品の解決 ResolveProjectScenario も Projects を見る）。
void SKaedeMomijiUIWidget::LoadProjectsManifest()
{
	Projects.Reset();
	const FString Manifest = KaedeVn::GetWorkRoot() / TEXT("projects") / TEXT("projects.json");
	nlohmann::json J;
	if (!ParseJsonFile(Manifest, J)) return;
	if (!J.is_object() || !J.contains("projects") || !J["projects"].is_array()) return;
	for (const auto& E : J["projects"])
	{
		// type!="vn"（idle=アルケミスト等）はレベル単位で分離しており、ノベルの作品には入れない
		//（起動の振り分けは GameInstance 側）。
		if (E.contains("type") && E["type"].is_string() && E["type"].get<std::string>() != "vn")
			continue;
		FProjectItem Item;
		if (E.contains("id") && E["id"].is_string())          Item.Id       = UTF8_TO_TCHAR(E["id"].get<std::string>().c_str());
		if (E.contains("title") && E["title"].is_string())    Item.Title    = UTF8_TO_TCHAR(E["title"].get<std::string>().c_str());
		if (E.contains("scenario") && E["scenario"].is_string()) Item.Scenario = UTF8_TO_TCHAR(E["scenario"].get<std::string>().c_str());
		if (Item.Scenario.IsEmpty()) Item.Scenario = TEXT("scenario.json");
		if (Item.Title.IsEmpty())    Item.Title = Item.Id.IsEmpty() ? TEXT("(無題)") : Item.Id;
		Projects.Add(MoveTemp(Item));
	}
}

// 単一作品で再生するシナリオ名（Game/相対）を Projects から決める。
//   -KaedeProject=<id> があればその id の作品、無ければ（見つからなければ）先頭の作品。
//   作品が無ければ "scenario.json"（従来既定）。
FString SKaedeMomijiUIWidget::ResolveProjectScenario() const
{
	if (Projects.Num() == 0) return TEXT("scenario.json");
	FString WantId;
	if (FParse::Value(FCommandLine::Get(), TEXT("KaedeProject="), WantId) && !WantId.IsEmpty())
	{
		for (const FProjectItem& P : Projects)
			if (P.Id.Equals(WantId, ESearchCase::CaseSensitive)) return P.Scenario;
	}
	return Projects[0].Scenario;
}

namespace
{
	// シナリオ JSON の "screen" から作品の論理解像度を解決する（2解像度対応。
	// 設計 Docs/Reports/2026/07/25/02）。work.json の同名フィールドをコンパイラが透過出力する。
	//   "screen": { "preset": "1080p" }      … プリセット名（正）
	//   "screen": { "w": 1920, "h": 1080 }   … 実寸指定（preset が無いときだけ見る）
	//   "screen": "1080p"                     … 文字列だけの短縮形
	// 未指定・未知名・壊れた値はすべて既定の 1920x1080。UE 側は 1080p に統一したので、
	// 720p で出したい作品だけが明示的に "screen": "720p" を書く。
	// （monorepo(native/web) は当面リリース予定がなく、後追いで 1080p 化する方針）
	void ResolveScreenSize(const nlohmann::json& J, int32& OutW, int32& OutH)
	{
		OutW = 1920;
		OutH = 1080;
		if (!J.is_object() || !J.contains("screen")) return;

		auto ApplyPreset = [&OutW, &OutH](const std::string& Name) -> bool
		{
			if (Name == "720p"  || Name == "1280x720")  { OutW = 1280; OutH = 720;  return true; }
			if (Name == "1080p" || Name == "1920x1080") { OutW = 1920; OutH = 1080; return true; }
			return false;
		};

		const nlohmann::json& S = J["screen"];
		if (S.is_string()) { ApplyPreset(S.get<std::string>()); return; }
		if (!S.is_object()) return;
		if (S.contains("preset") && S["preset"].is_string()
			&& ApplyPreset(S["preset"].get<std::string>())) return;
		if (S.contains("w") && S["w"].is_number_integer()
			&& S.contains("h") && S["h"].is_number_integer())
		{
			OutW = FMath::Max(1, (int32)S["w"].get<int>());
			OutH = FMath::Max(1, (int32)S["h"].get<int>());
		}
	}
}

// Game/<ScenarioName> を PendingScenarioJson に読み、WorkTitle を JSON の "title" から設定。
// あわせて作品設定の解像度（"screen"）を論理キャンバスへ反映する。
// 読めなければ PendingScenarioJson を空にして組み込みデモへフォールバック。
void SKaedeMomijiUIWidget::LoadScenarioIntoPending(const FString& ScenarioName)
{
	// 前の作品の絵を捨てて、この作品の assets.json を読み直す。
	ResetSceneAssets();
	const FString ScenarioPath = KaedeVn::GetWorkRoot() / ScenarioName;
	if (FFileHelper::LoadFileToString(PendingScenarioJson, *ScenarioPath))
	{
		UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] scenario ready: %s"), *ScenarioPath);
		WorkTitle = TEXT("kaedevn");
		int32 ScreenW = 1920, ScreenH = 1080;
		nlohmann::json J;
		if (ParseJsonText(PendingScenarioJson, ScenarioPath, J))
		{
			if (J.is_object() && J.contains("title") && J["title"].is_string())
				WorkTitle = UTF8_TO_TCHAR(J["title"].get<std::string>().c_str());
			ResolveScreenSize(J, ScreenW, ScreenH);
		}
		// 帯ストリップ（コンパクト）は専用寸法で組まれているので作品設定では動かさない。
		// ただし値は保持する（1枠を全画面へ展開するときにこの寸法を使う）。
		// 作品を切り替えたときは未指定の作品が 1920x1080 へ戻る（作品選択で行き来できる）。
		ScenarioScreenW = ScreenW;
		ScenarioScreenH = ScreenH;
		if (!bCompactLayout) SetLogicalSize(ScreenW, ScreenH);

		// TIMELINE_PLAY 用のタイムライン。シナリオと同じディレクトリの timelines.json
		// （変換ツールの converted/ts/timelines.json と同じ形: "<id>": TimelineRoot）。
		// **無いのが正常**（多くの作品はタイムラインを使わない）。BeginScenario で注入する。
		const FString TimelinePath = FPaths::GetPath(ScenarioPath) / TEXT("timelines.json");
		if (!FFileHelper::LoadFileToString(PendingTimelinesJson, *TimelinePath))
		{
			PendingTimelinesJson.Reset();
		}
	}
	else
	{
		UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] scenario not found: %s (組み込みデモにフォールバック)"), *ScenarioPath);
		PendingScenarioJson.Reset();
		PendingTimelinesJson.Reset();
		WorkTitle = TEXT("kaedevn デモ");
	}
}

// 作品選択で Index を選ぶ。シナリオが読めればタイトル画面へ遷移して true。読めなければ false（選択画面に留まる）。
bool SKaedeMomijiUIWidget::SelectProject(int32 Index)
{
	if (!Projects.IsValidIndex(Index)) return false;
	LoadScenarioIntoPending(Projects[Index].Scenario);
	if (PendingScenarioJson.IsEmpty())
	{
		ShowToast(FString::Printf(TEXT("「%s」のシナリオが見つかりません"), *Projects[Index].Title));
		return false;
	}
	SelectedProject = Index;
	Screen = EScreen::Title;
	RefreshTitleTree();   // 作品名（logo Label）を選択作品で更新
	Tree = Session.CurrentTree();
	return true;
}

void SKaedeMomijiUIWidget::BeginScenario()
{
	Session.ResetState();   // やり直し時の見た目/本文/履歴をクリア。
	bool bStarted = false;
	if (!PendingScenarioJson.IsEmpty())
	{
		// タイムラインはシナリオより先に入れる（冒頭の TIMELINE_PLAY でも引けるように）。
		if (!PendingTimelinesJson.IsEmpty())
		{
			if (Session.SetTimelinesFromJson(TCHAR_TO_UTF8(*PendingTimelinesJson)))
			{
				UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] timelines loaded: %d"), Session.NumTimelines());
			}
			else
			{
				UE_LOG(LogKaedeVn, Warning, TEXT("[kaedevn] timelines.json の解析に失敗（TIMELINE_PLAY は空振りします）"));
			}
		}
		bStarted = Session.StartFromJson(TCHAR_TO_UTF8(*PendingScenarioJson));
	}
	if (!bStarted)
	{
		Session.StartDemo();
		UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] using built-in demo scenario"));
	}
	bDidSelect = false;
	bAutoMode = bSkipMode = false;   // 新規開始/やり直しはオート/スキップを解除
	Screen = EScreen::Playing;
	ApplySettings();   // メッセージ速度等をこのセッションに実効き
	Tree = Session.CurrentTree();
}

void SKaedeMomijiUIWidget::ReturnToTitle()
{
	Session.ResetState();
	// 複数作品なら作品選択へ、単一作品ならタイトルへ戻す。
	Screen = bMultiProject ? EScreen::Select : EScreen::Title;
	Tree = Session.CurrentTree();
}

// UIスクショ自動撮影: 画面を順に開いて FScreenshotRequest → 全部撮ったら終了。
// 位相: 0.5s 土台画面（タイトル/本編）→ 1.6s オーバーレイ → 2.4s 撮影 → 3.2s 次へ。
void SKaedeMomijiUIWidget::TickShotSequence(float DeltaTime)
{
#if !UE_BUILD_SHIPPING
	if (!ShotQueue.IsValidIndex(ShotIndex))
	{
		ShotIndex = -1;
		if (GEngine && GEngine->GameViewport)
			GEngine->GameViewport->ConsoleCommand(TEXT("quit"));
		return;
	}
	ShotTimer += DeltaTime;
	// -KaedeVnFocus: ゲームパッド操作中の見た目（フォーカスリング＋入力ガイド）を撮る（入力レス）。
	if (bShotFocus) { LastInputDevice = EInputDevice::Gamepad; bFocusVisible = true; }
	// -KaedeVnAuto: 本編中はオート再生を強制（DriveAutoSkip が本文を自動送りする）。
	if (bShotAuto && Screen == EScreen::Playing) bAutoMode = true;
	const FString Name = ShotQueue[ShotIndex].TrimStartAndEnd().ToLower();
	const bool bPlayOnly = Name == TEXT("play");   // 本編そのもの（オーバーレイ無し）
	const bool bOverPlaying = Name == TEXT("menu") || Name == TEXT("save")
	                       || Name == TEXT("load") || Name == TEXT("manual");

	if (!bShotSetupDone && ShotTimer >= 0.5f)
	{
		bShotSetupDone = true;
		OverlayName.Reset(); OverlayStack.Reset();
		if (bPlayOnly || bOverPlaying)
		{
			if (Screen != EScreen::Playing) BeginScenario();  // 本編を開始
		}
		else if (Screen != EScreen::Title)
		{
			RefreshTitleTree();
			ReturnToTitle();
		}
	}
	if (bShotSetupDone && !bShotOverlayDone && ShotTimer >= 1.6f)
	{
		bShotOverlayDone = true;
		if (!bPlayOnly && Name != TEXT("title")) OpenOverlay(Name);  // play/title はオーバーレイ無し
	}
	if (bShotOverlayDone && !bShotRequested && ShotTimer >= 2.4f)
	{
		bShotRequested = true;
		const FString Dir = ShotOutDir.IsEmpty()
			? (FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("VnUi")) : ShotOutDir;
		IFileManager::Get().MakeDirectory(*Dir, /*Tree*/ true);
		const FString File = Dir / FString::Printf(TEXT("vn-%s.png"), *Name);
		FScreenshotRequest::RequestScreenshot(File, /*bShowUI*/ true, /*bAddUniqueSuffix*/ false);
		UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn-shots] requested: %s"), *File);
		if (bShotAuto)
			UE_LOG(LogKaedeVn, Display, TEXT("[kaede-vn-auto] auto=%d History lines=%d (>1 なら自動送り成立)"),
				bAutoMode ? 1 : 0, (int32)Session.History().size());
	}
	if (ShotTimer >= 3.2f)
	{
		ShotTimer = 0.f;
		bShotSetupDone = bShotOverlayDone = bShotRequested = false;
		++ShotIndex;
	}
#endif
}

void SKaedeMomijiUIWidget::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime,
	const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);

	// コンパクト表示の論理サイズは固定（呼び出し側が stripH×アスペクトから計算して渡す）。
	// ズレは OnPaint のレターボックスが吸収する — 全画面ノベルと同じ方式。
	// 「割り当て実寸への追従」は禁止: Tick の実寸は UE の自動UI縮小が掛かった Slate 単位で
	// 物理pxとは別物なので、追従すると縮尺と文字サイズが設計からズレる（実測）。
	// 初回に1回だけ配置の検証値をログへ出す。親スロットが論理サイズと同じ 16:9 なら
	// physScale≒1.0（本文16pxが実16px）になるのが合格条件。
	if (bCompactLayout && !bLoggedCompactMetrics)
	{
		const FVector2f Size = AllottedGeometry.GetLocalSize();
		if (Size.X > 1.f && Size.Y > 1.f && LogicalW > 0 && LogicalH > 0)
		{
			bLoggedCompactMetrics = true;
			const float DpiScale = AllottedGeometry.Scale;
			const float Letterbox = FMath::Min(Size.X / LogicalW, Size.Y / LogicalH);
			const float PhysScale = Letterbox * DpiScale;
			UE_LOG(LogKaedeVn, Display,
				TEXT("[kaedevn] compact frame metrics: slot slate %.1fx%.1f dpi=%.3f (phys %.0fx%.0f) | logical %dx%d, letterbox=%.3f, physScale=%.3f, font16 -> %.1f phys px"),
				Size.X, Size.Y, DpiScale, Size.X * DpiScale, Size.Y * DpiScale,
				LogicalW, LogicalH, Letterbox, PhysScale, 16.f * PhysScale);
		}
	}

	if (ShotIndex >= 0) TickShotSequence(InDeltaTime);

	if (ToastTimer > 0.f) ToastTimer = FMath::Max(0.f, ToastTimer - InDeltaTime);

	// 本編中だけセッションを駆動する（Title / End / メニュー等のオーバーレイ表示中は進めない）。
	// UI_SHOW でシナリオが開いた画面が閉じられたら、アクションをシナリオへ返す。
	// wait=true の UI_SHOW はこれが来るまで pc を進めない＝ここを忘れると進行が止まる。
	// **オーバーレイ表示中は Session.Tick が回らない**ので、この判定は Playing ブロックの外に置く。
	if (Screen == EScreen::Playing && !UiShowScreen.IsEmpty() && OverlayName != UiShowScreen)
	{
		UiShowScreen.Reset();
		// 画面側から jump:<label> を返す語彙はまだ無い（ランナー側は対応済み）。今は close 固定。
		Session.NotifyUiAction(TEXT("close"));
	}

	if (Screen == EScreen::Playing && OverlayName.IsEmpty())
	{
		Session.Tick(InDeltaTime * 1000.0f);  // 秒 → ミリ秒

		// UI_SHOW の要求を拾って画面を開く。開けなければ（画面JSONが無い等）
		// OpenOverlay がトーストを出して何もしないので、次フレームで close 扱いになり進行は止まらない。
		if (const FString Pending = Session.PendingUiScreen(); !Pending.IsEmpty() && UiShowScreen.IsEmpty())
		{
			UiShowScreen = Pending;
			OpenOverlay(Pending);
		}

		// 撮影用: 数行進めてから自動クイックセーブ（トーストを撮る）。
		if (bSaveDemo)
		{
			DemoTime += InDeltaTime;
			if (DemoTime > 1.2f && !bDemoAdvanced) { Session.HandleClick(); bDemoAdvanced = true; }
			if (DemoTime > 3.2f && !bDemoSaved)    { QuickSave(); bDemoSaved = true; }
		}

		// 検証/スクショ用の自動進行。
		if (bAutoToChoice && !Session.IsWaitingForChoice() && !Session.IsFinished())
		{
			Session.HandleClick();
		}
		else if (bToBranch && !bDidSelect)
		{
			if (Session.IsWaitingForChoice()) { Session.SelectChoice(0); bDidSelect = true; }
			else if (!Session.IsFinished()) { Session.HandleClick(); }
		}
		else if (bToEnd && !Session.IsFinished())
		{
			if (Session.IsWaitingForChoice()) { Session.SelectChoice(0); }
			else { Session.HandleClick(); }
		}

		// オート/スキップの自動送り（マウス/キー入力と同じ Session を駆動）。
		DriveAutoSkip(InDeltaTime);

		Tree = Session.CurrentTree();

		// 3Dノベル(Lvl_KaedeNovel): 読み進めた行数が変わったら、表情の切り替えを外へ知らせる。
		// 受ける側（顔に表情を入れる処理）はここでは知らない（KaedeVnExpression.h）。
		if (bThreeDStage)
		{
			const int32 LineIdx = (int32)Session.History().size();
			if (LineIdx != LastFaceIdx)
			{
				LastFaceIdx = LineIdx;
				FKaedeVnExpressionRequest Request;
				Request.ExpressionIndex = LineIdx;
				KaedeVn::OnExpressionRequest().Broadcast(Request);
			}
		}

		// シナリオ完了 → END 画面へ自動遷移。
		if (Session.IsFinished())
		{
			Screen = EScreen::End;
			bAutoMode = bSkipMode = false;   // オート/スキップは END で解除
			UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn] scenario finished -> END screen"));
		}
	}

	// SCREEN_FILTER: 背景テクスチャを .usf でフィルタして FilterRT に書き出す。
	// （クロスフェード中はスキップして従来描画にフォールバック）
	const int32 FType = MapFilterType(Session.FilterName());
	const kaedevn::GameScreenState& FSt = Session.State();
	if (FType != 0 && !FSt.bgId.empty() && !FSt.bgTransition.has_value())
	{
		if (!FilterRT)
		{
			FilterRT.Reset(NewObject<UTextureRenderTarget2D>());
			FilterRT->RenderTargetFormat = RTF_RGBA8;
			FilterRT->InitAutoFormat(LogicalW, LogicalH);
			FilterRT->ClearColor = FLinearColor::Black;
			FilterRT->bAutoGenerateMips = false;
			FilterRT->UpdateResourceImmediate(true);

			FilterBrush = MakeShared<FSlateBrush>();
			FilterBrush->SetResourceObject(FilterRT.Get());
			FilterBrush->ImageSize = FVector2D(LogicalW, LogicalH);
			FilterBrush->DrawAs = ESlateBrushDrawType::Image;
		}
		if (UTexture* BgTex = ResolveBackgroundTexture(UTF8_TO_TCHAR(FSt.bgId.c_str())))
		{
			KaedeShaders::ApplyFilter(FilterRT.Get(), BgTex, FType, Session.FilterIntensity());
			bFilterActive = true;
		}
	}
	else
	{
		bFilterActive = false;
	}
}

// ===== 描画 =====
// OnPaint は画面（作品選択・タイトル・本編）を選ぶだけで、描くのは画面ごとの Paint* 関数。
// 層（LayerId）の進め方は 1 つの OnPaint だったときと同じ（分けただけで見た目は変えない。2026-10-18 Issue #60）。

namespace KaedeVn
{
// OnPaint の各段が共有する描画の文脈（レターボックス・SHAKE・カメラ・字の計測）。このファイルだけで使う。
struct FVnPaintContext
{
	const FGeometry& Geometry;
	FSlateWindowElementList& Out;
	FKaedeLetterbox Box;               // 論理 → ローカル（SHAKE の揺れ込み）
	KaedeUI::FKaedeMeasureFn Measure;  // 論理 px の字の計測（ComputeDrawList 用）
	float LogicalW = 0.f, LogicalH = 0.f;
	// JSON を持たない固定描画（タイトル/作品選択/END/トースト/入力ガイド/モードバッジ）の寸法は
	// 1280x720 基準のリテラルで書かれている。論理キャンバスが 1920x1080 のときは 1.5 倍して
	// 同じ見かけの大きさで出す。JSON 画面側は BuildUiDisplayTree の ScaleUiTree が担当。
	float UiK = 1.f;
	// カメラ（CAMERA_SET）。シーン（背景・立ち絵・スプライト・一枚絵）にだけ掛ける。本文枠やオーバーレイUIには
	// 掛けない＝カメラを寄せても文字は読めるまま。拡大は論理キャンバスの中心が基準で、そのあと論理px でパンする。
	float CamZoom = 1.f, CamX = 0.f, CamY = 0.f;

	float Scale() const { return Box.Scale; }
	float LP(float V) const { return V * UiK; }   // 1280基準の論理px → 現在の論理px
	FVector2f ToLocal(float X, float Y) const { return Box.ToLocal(X, Y); }
	// 論理座標の矩形（大きさも論理 px）。
	FPaintGeometry Rect(float X, float Y, float W, float H) const
	{
		return Geometry.ToPaintGeometry(FVector2f(W * Box.Scale, H * Box.Scale), FSlateLayoutTransform(ToLocal(X, Y)));
	}
	float SceneScale() const { return Box.Scale * CamZoom; }
	// 論理座標 → 画面座標（カメラ込み）。原点と揺れは ToLocal と同じ。
	FVector2f SceneToLocal(float X, float Y) const
	{
		const float CX = LogicalW * 0.5f, CY = LogicalH * 0.5f;
		return ToLocal((X - CX) * CamZoom + CX - CamX, (Y - CY) * CamZoom + CY - CamY);
	}
	// 論理座標の矩形（大きさも論理 px）をカメラ込みで。
	FPaintGeometry SceneRect(float X, float Y, float W, float H) const
	{
		return Geometry.ToPaintGeometry(FVector2f(W * SceneScale(), H * SceneScale()), FSlateLayoutTransform(SceneToLocal(X, Y)));
	}
	// 固定描画の字（大きさは論理 px）。
	FSlateFontInfo Font(bool bBold, float LogicalPx) const { return MakeVnFont(bBold, FMath::RoundToInt(LogicalPx * Box.Scale)); }
};
}

namespace
{
	using KaedeVn::FVnPaintContext;

	// 作品選択・固定タイトルの地の色（0x1a1a2e）と押しボタンの青（web の 0x2563eb）。
	const FLinearColor VnScreenBgColor(0.102f, 0.102f, 0.180f, 1.f);
	const FLinearColor VnButtonBlueColor(0.145f, 0.388f, 0.922f, 0.95f);

	// テーマの色を固定描画の色にする（固定描画は sRGB の値をそのまま渡してきた。DrawKaedeCmds の
	// FromSRGBColor とは式が違うが、見た目を変えないためにそのままにする）。
	FLinearColor ThemeColor(const kaedevn::ui::Color& C)
	{
		return FLinearColor(C.r / 255.f, C.g / 255.f, C.b / 255.f, 1.f);
	}

	// 字の大きさ（ローカル px）。
	FVector2D MeasureText(const FString& Text, const FSlateFontInfo& Font)
	{
		return FSlateApplication::Get().GetRenderer()->GetFontMeasureService()->Measure(Text, Font);
	}

	void FillRect(const FVnPaintContext& Ctx, int32 Layer, float X, float Y, float W, float H, const FLinearColor& Color)
	{
		FSlateDrawElement::MakeBox(Ctx.Out, Layer, Ctx.Rect(X, Y, W, H), FCoreStyle::Get().GetBrush("WhiteBrush"),
			ESlateDrawEffect::None, Color);
	}

	// 1 行の字を横中央に置く（Y と字の箱の高さ BoxH は論理 px）。
	void PaintCenteredText(const FVnPaintContext& Ctx, int32 Layer, const FString& Text, const FSlateFontInfo& Font,
		float Y, float BoxH, const FLinearColor& Color)
	{
		const float Wpx = (float)MeasureText(Text, Font).X;
		const FPaintGeometry PG = Ctx.Geometry.ToPaintGeometry(FVector2f(4000.f, BoxH * Ctx.Scale()),
			FSlateLayoutTransform(Ctx.ToLocal((Ctx.LogicalW - Wpx / Ctx.Scale()) * 0.5f, Y)));
		FSlateDrawElement::MakeText(Ctx.Out, Layer, PG, Text, Font, ESlateDrawEffect::None, Color);
	}

	// 押しボタン（箱は Layer・白い字は Layer+1）。字は箱の中央へ、字面の補正（BiasFontPt の論理 px）込みで置く。
	void PaintButton(const FVnPaintContext& Ctx, int32 Layer, float BX, float BY, float BW, float BH,
		const FLinearColor& BoxColor, const FString& Label, const FSlateFontInfo& Font, float BiasFontPt)
	{
		FillRect(Ctx, Layer, BX, BY, BW, BH, BoxColor);
		const FVector2D LSz = MeasureText(Label, Font);
		const float S = Ctx.Scale();
		const FPaintGeometry LblPG = Ctx.Geometry.ToPaintGeometry(FVector2f(4000.f, BH * S),
			FSlateLayoutTransform(Ctx.ToLocal(BX + (BW - (float)LSz.X / S) * 0.5f,
			                                  BY + (BH - (float)LSz.Y / S) * 0.5f
			                                  - KaedeUI::KaedeTextCenterBiasEm * BiasFontPt)));
		FSlateDrawElement::MakeText(Ctx.Out, Layer + 1, LblPG, Label, Font, ESlateDrawEffect::None, FLinearColor::White);
	}
}

int32 SKaedeMomijiUIWidget::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry,
	const FSlateRect& MyCullingRect, FSlateWindowElementList& OutDrawElements,
	int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	// 論理キャンバスをアロット領域へアスペクト維持で収める（レターボックス）。
	const KaedeVn::FKaedeLetterbox Fit =
		KaedeVn::FKaedeLetterbox::Fit(AllottedGeometry.GetLocalSize(), LogicalW, LogicalH);
	if (!Fit.IsValid()) return LayerId;

	// SHAKE: 画面全体の原点をずらす（揺れ幅は論理px）。
	// レターボックスの黒帯へはみ出す分は帯に隠れるだけなので、クリップは不要。
	float ShakeX = 0.f, ShakeY = 0.f;
	Session.ShakeOffset(ShakeX, ShakeY);
	KaedeVn::FVnPaintContext Ctx{ AllottedGeometry, OutDrawElements, Fit.Shifted(ShakeX, ShakeY),
		KaedeVn::MakeVnMeasure(LogicalFontSize), (float)LogicalW, (float)LogicalH, (float)UiScaleX() };
	Session.CameraOffset(Ctx.CamX, Ctx.CamY);
	Ctx.CamZoom = FMath::Max(0.01f, Session.CameraZoom());

	// 本編の選択肢の当たり判定は本編の画面だけが作り直す。ほかの画面では捨てておく
	// （画面が変わった直後のクリックが前の本編の選択肢に当たらないように）。
	CachedHits.Reset();
	switch (Screen)
	{
	case EScreen::Select: return PaintSelectScreen(Ctx, LayerId);
	case EScreen::Title:  return bTitleTreeLoaded ? PaintTitleScreen(Ctx, LayerId) : PaintFallbackTitle(Ctx, LayerId);
	default:              return PaintPlayScreen(Ctx, LayerId);   // 本編と END（END は本編の上に暗幕）
	}
}

// 作品選択（作品が 2 件以上のとき）。ボタンの当たり判定を ProjectHits に集める。
int32 SKaedeMomijiUIWidget::PaintSelectScreen(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	FillRect(Ctx, Layer, 0.f, 0.f, LogicalW, LogicalH, VnScreenBgColor);
	// 見出し「作品を選択」（白・太字・中央・18%H）
	PaintCenteredText(Ctx, Layer + 1, TEXT("作品を選択"), Ctx.Font(true, Ctx.LP(34.f)),
		LogicalH * 0.18f - Ctx.LP(20.f), Ctx.LP(44.f), FLinearColor::White);

	// 作品ボタンを縦に並べる。フォーカス中(SelectedProject)は明るい青、他は暗い青。
	ProjectHits.Reset();
	const float BW = Ctx.LP(560.f), BH = Ctx.LP(60.f), Gap = Ctx.LP(16.f);
	const float BX = (LogicalW - BW) * 0.5f;
	const float StartY = LogicalH * 0.30f;
	const FSlateFontInfo ItemFont = Ctx.Font(false, Ctx.LP(24.f));
	for (int32 i = 0; i < Projects.Num(); ++i)
	{
		const float BY = StartY + i * (BH + Gap);
		KaedeUI::FKaedeHit& Hit = ProjectHits.AddDefaulted_GetRef();
		Hit.X = BX; Hit.Y = BY; Hit.W = BW; Hit.H = BH;
		const FLinearColor BoxCol = (i == SelectedProject) ? VnButtonBlueColor : FLinearColor(0.16f, 0.18f, 0.28f, 0.95f);
		PaintButton(Ctx, Layer + 1, BX, BY, BW, BH, BoxCol, Projects[i].Title, ItemFont, Ctx.LP(24.f));
	}

	// フッターのヒント
	PaintCenteredText(Ctx, Layer + 1, TEXT("クリック / ↑↓ + Enter で選択"), Ctx.Font(false, Ctx.LP(18.f)),
		LogicalH * 0.90f, Ctx.LP(28.f), FLinearColor(0.7f, 0.7f, 0.78f, 1.f));
	return Layer + 3;
}

// 宣言的タイトル（Game/ui/title.json）: はじめる/つづきから/目次/設定/終了。
// テーマ背景の上に UiNode を描き、ボタンのヒットを TitleHits に収集する。
int32 SKaedeMomijiUIWidget::PaintTitleScreen(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	FillRect(Ctx, Layer, 0.f, 0.f, LogicalW, LogicalH, ThemeColor(UiThemeCurrent.bg));
	TitleHits.Reset();
	const TArray<KaedeUI::FKaedeDrawCmd> TitleCmds = KaedeUI::ComputeDrawList(
		BuildUiDisplayTree(TitleTree), LogicalW, LogicalH, Ctx.Measure, &TitleHits, &UiThemeCurrent);
	const int32 L = PaintOverlay(Ctx,
		KaedeVn::DrawKaedeCmds(TitleCmds, Ctx.Geometry, Ctx.Box, Ctx.Out, Layer + 1, (float)LogicalFontSize));
	PaintFocusGuideToast(Ctx, L);
	return L + 4;
}

// フォールバック（title.json 無し）: 従来の固定タイトル。クリックで開始。
int32 SKaedeMomijiUIWidget::PaintFallbackTitle(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	FillRect(Ctx, Layer, 0.f, 0.f, LogicalW, LogicalH, VnScreenBgColor);
	// タイトル文字（白・太字・中央・32%H）
	PaintCenteredText(Ctx, Layer + 1, WorkTitle, Ctx.Font(true, Ctx.LP(48.f)),
		LogicalH * 0.32f - Ctx.LP(28.f), Ctx.LP(56.f), FLinearColor::White);
	// 開始ボタン（web: 青 0x2563eb・中央・55%H）。クリック / Enter で開始。
	const float BW = Ctx.LP(380.f), BH = Ctx.LP(56.f);
	PaintButton(Ctx, Layer + 1, (LogicalW - BW) * 0.5f, LogicalH * 0.55f, BW, BH, VnButtonBlueColor,
		TEXT("はじめる  ▶  クリック / Enter"), Ctx.Font(false, LogicalFontSize), LogicalFontSize);
	return Layer + 3;
}

// 本編（と END）。シーン → 本文枠/選択肢 → END → オーバーレイ → フォーカス/トースト → 全画面エフェクト。
int32 SKaedeMomijiUIWidget::PaintPlayScreen(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	// ===== シーン層（UI ツリーの下）: 背景 → 立ち絵 → スプライト → 一枚絵 =====
	// 3Dノベルレベル(Lvl_KaedeNovel)では 2D のシーンを描かず、実3Dレベルを見せる（テキストのみ重畳）。
	if (!bThreeDStage) PaintBackground(Ctx, Layer);
	++Layer;
	if (!bThreeDStage) PaintCharacters(Ctx, Layer);
	++Layer;
	if (!bThreeDStage) Layer = PaintSprites(Ctx, Layer);
	++Layer;
	if (!bThreeDStage) PaintImageOverlays(Ctx, Layer);
	++Layer;

	// ===== UI 層（テキスト枠・選択肢） =====
	const TArray<KaedeUI::FKaedeDrawCmd> Cmds =
		KaedeUI::ComputeDrawList(Tree, LogicalW, LogicalH, Ctx.Measure, &CachedHits);
	Layer = KaedeVn::DrawKaedeCmds(Cmds, Ctx.Geometry, Ctx.Box, Ctx.Out, Layer, (float)LogicalFontSize);

	// 選択肢フォーカスのリング（キーボード/ゲームパッド操作の可視化）。
	if (Session.IsWaitingForChoice() && CachedHits.IsValidIndex(Session.GetFocusedChoice()))
		PaintFocusRing(Ctx, CachedHits[Session.GetFocusedChoice()], Layer + 1);
	PaintModeBadge(Ctx, Layer + 2);
	if (Screen == EScreen::End) PaintEndScreen(Ctx, Layer + 2);

	// ===== オーバーレイ（メニュー/設定/目次/セーブ/ロード/解説書）→ フォーカス → トースト =====
	Layer = PaintOverlay(Ctx, Layer + 5);   // END 画面（+2..+4）より上に重ねる
	PaintFocusGuideToast(Ctx, Layer);
	PaintScreenEffects(Ctx, Layer + 3);
	return Layer + 4;
}

// 背景。LAYER_SET / TRANSITION による background レイヤの可視性・不透明度に従う。
void SKaedeMomijiUIWidget::PaintBackground(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	const float LayerOpacity = Session.LayerOpacity("background");
	if (!Session.LayerVisible("background") || LayerOpacity <= 0.f) return;
	const kaedevn::GameScreenState& St = Session.State();
	if (bFilterActive && FilterBrush.IsValid())
	{
		// SCREEN_FILTER 適用済みの背景（.usf 出力の RT）。カメラはここにも掛かる。
		FSlateDrawElement::MakeBox(Ctx.Out, Layer, Ctx.SceneRect(0.f, 0.f, LogicalW, LogicalH), FilterBrush.Get(),
			ESlateDrawEffect::None, FLinearColor::White);
	}
	else if (St.bgTransition.has_value())
	{
		// クロスフェード: from を薄く、to を progress で重ねる。
		const kaedevn::BgTransition& T = St.bgTransition.value();
		PaintBackgroundImage(Ctx, Layer, UTF8_TO_TCHAR(T.fromId.c_str()), LayerOpacity);
		PaintBackgroundImage(Ctx, Layer, UTF8_TO_TCHAR(T.toId.c_str()), FMath::Clamp(T.progress, 0.f, 1.f) * LayerOpacity);
	}
	else if (!St.bgId.empty())
	{
		PaintBackgroundImage(Ctx, Layer, UTF8_TO_TCHAR(St.bgId.c_str()), LayerOpacity);
	}
}

// 背景の絵 1 枚。背景は 16:9 とは限らない。横画面では「高さ基準」でフィットし水平センタリング
// （実アスペクト比を維持＝引き伸ばし歪みを防ぐ。幅が画面より広ければ左右クロップ、狭ければレターボックス）。
void SKaedeMomijiUIWidget::PaintBackgroundImage(const KaedeVn::FVnPaintContext& Ctx, int32 Layer,
	const FString& Id, float Alpha) const
{
	if (Alpha <= 0.f) return;
	const FSlateBrush* Bg = GetSceneBrush(Id);
	if (!Bg) return;
	UTexture2D* BgTex = GetSceneTexture(Id);
	const float BgAspect = (BgTex && BgTex->GetSizeY() > 0)
		? (float)BgTex->GetSizeX() / (float)BgTex->GetSizeY()
		: (LogicalH > 0.f ? LogicalW / LogicalH : 1.7777f);
	const float BH = LogicalH;
	const float BW = BH * BgAspect;
	const float BX = (LogicalW - BW) * 0.5f;
	FSlateDrawElement::MakeBox(Ctx.Out, Layer, Ctx.SceneRect(BX, 0.f, BW, BH), Bg,
		ESlateDrawEffect::None, FLinearColor(1.f, 1.f, 1.f, Alpha));
}

// 立ち絵。LAYER_SET / TRANSITION による character レイヤの可視性・不透明度に従う。
void SKaedeMomijiUIWidget::PaintCharacters(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	const float LayerOpacity = Session.LayerOpacity("character");
	if (!Session.LayerVisible("character") || LayerOpacity <= 0.f) return;
	// 高さ・左右の余白は論理解像度に対する比（KaedeVn::CharPlacement。エディタのプレビューと同じ）。
	const KaedeVn::FKaedeCharPlacement Place = KaedeVn::CharPlacement(LogicalW, LogicalH);
	for (const auto& Kv : Session.State().characters)
	{
		const kaedevn::ScreenCharacterState& Ch = Kv.second;
		// 表情差分（CH_EXPR）の解決: assets.json に "<name>_<pose>" があればそれを使い、
		// 無ければ従来どおり "<name>" に落ちる。表情を登録していない既存作品は
		// 見た目が一切変わらない（純粋な追加）。
		// NOTE: この "_" 連結は Phase 1 で導入した規約。characters.json（slug＋表情slug→storage）
		//   を runtime が読むようになれば、そちらへ寄せるべき。現状 characters.json は
		//   KaedeEditor しか読んでいない。
		FString CharId = UTF8_TO_TCHAR(Ch.name.c_str());
		if (!Ch.pose.empty())
		{
			const FString Composed = CharId + TEXT("_") + UTF8_TO_TCHAR(Ch.pose.c_str());
			if (AssetMap.Contains(Composed)) CharId = Composed;
		}
		const FSlateBrush* CharBrush = GetSceneBrush(CharId);
		if (!CharBrush) continue;
		// テクスチャのアスペクト比で配置（下端そろえ）。
		UTexture2D* CharTex = GetSceneTexture(CharId);
		const float CH = Place.Height;
		const float Aspect = (CharTex && CharTex->GetSizeY() > 0)
			? (float)CharTex->GetSizeX() / (float)CharTex->GetSizeY() : 0.6f;
		const float CW = CH * Aspect;
		// 水平位置は連続値 xNorm（0=左端 / 0.5=中央 / 1=右端）から出す。CH_MOVE で
		// 途中の値になる。0/0.5/1 は従来の left/center/right と厳密に一致する
		//（xNorm=0.5 のとき SideMargin が相殺されて (LogicalW-CW)/2 になる）。
		const float CX = Place.SideMargin + (LogicalW - Place.SideMargin * 2.f - CW) * Ch.xNorm;
		const float CY = LogicalH - CH;
		FSlateDrawElement::MakeBox(Ctx.Out, Layer, Ctx.SceneRect(CX, CY, CW, CH), CharBrush,
			ESlateDrawEffect::None, FLinearColor(1.f, 1.f, 1.f, Ch.alpha * LayerOpacity));
	}
}

// スプライト（SPRITE_SET / MOVE / HIDE / CLEAR）。次の空き層を返す。
// Tyrano [image] 相当。オーバーレイ（一枚絵CG）と違い、座標は論理px の絶対指定で
// サイズはテクスチャの実寸（×scale）。中央寄せもフィットもしない＝作者が置いた位置に出る。
// 描画順は order 昇順（back=0 → front=1）。同 order 内は SPRITE_SET した順に重なる。
int32 SKaedeMomijiUIWidget::PaintSprites(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	// LAYER_SET / TRANSITION による overlay レイヤの可視性・不透明度。
	const float LayerOpacity = Session.LayerOpacity("overlay");
	if (!Session.LayerVisible("overlay") || LayerOpacity <= 0.f) return Layer;
	// **1枚ごとに LayerId を進める。** Slate は同一 LayerId 内でテキストと矩形を
	// 別バッチにまとめるため、同じ Layer に積むと提出順が保たれず、後から出した
	// テキストスプライトが画像スプライトの下に潜る（2026-07-29 に実画面で確認）。
	for (int32 Pass = 0; Pass <= 1; ++Pass)
	{
		for (const FKaedeSpriteItem& Sp : Session.Sprites())
		{
			if (Sp.order != Pass || Sp.alpha <= 0.f) continue;
			const float A = Sp.alpha * LayerOpacity;
			const int32 ThisLayer = Layer++;

			if (Sp.bIsText)
			{
				// テキストスプライト（TEXT_SPRITE_SET / Tyrano [ptext]）。
				// 左上原点の絶対座標。メッセージ枠とは無関係に置かれる。
				const FString Body = UTF8_TO_TCHAR(Sp.text.c_str());
				if (Body.IsEmpty()) continue;
				const FSlateFontInfo Font = KaedeVn::MakeVnFont(
					Sp.bBold, FMath::RoundToInt(Sp.fontSize * Sp.scale * Ctx.SceneScale()));
				FLinearColor Col = FLinearColor::White;
				// "#rrggbb" は FromHex、色名（white 等）はここでは白のまま。
				const FString ColStr = UTF8_TO_TCHAR(Sp.color.c_str());
				if (ColStr.StartsWith(TEXT("#"))) Col = FLinearColor(FColor::FromHex(ColStr));
				Col.A = A;
				const FPaintGeometry PG = Ctx.Geometry.ToPaintGeometry(
					FVector2f(1.f, 1.f), FSlateLayoutTransform(Ctx.SceneToLocal(Sp.x, Sp.y)));
				FSlateDrawElement::MakeText(Ctx.Out, ThisLayer, PG, Body, Font, ESlateDrawEffect::None, Col);
				continue;
			}

			// 絵の解決に使うのは storage（assets.json の id）。Sp.id はシナリオ上の識別子。
			const FString SpId = UTF8_TO_TCHAR(Sp.storage.c_str());
			const FSlateBrush* SpBrush = GetSceneBrush(SpId);
			if (!SpBrush) continue;
			UTexture2D* SpTex = GetSceneTexture(SpId);
			if (!SpTex) continue;
			const float SW = (float)SpTex->GetSizeX() * Sp.scale;
			const float SH = (float)SpTex->GetSizeY() * Sp.scale;
			FSlateDrawElement::MakeBox(Ctx.Out, ThisLayer, Ctx.SceneRect(Sp.x, Sp.y, SW, SH), SpBrush,
				ESlateDrawEffect::None, FLinearColor(1.f, 1.f, 1.f, A));
		}
	}
	return Layer;   // 使った分だけ進める（次の描画が下に潜らないように）
}

// 画像オーバーレイ（OVERLAY_SET）。一枚絵CG。背景・立ち絵より上、本文枠より下＝オーバーレイの上に文字が乗る。
// s=1.0 / x=y=0 で背景と同じ「高さ基準フィット・水平センタリング」になる＝
// 引数なしの OVERLAY_SET が全画面CGとして素直に使える。
void SKaedeMomijiUIWidget::PaintImageOverlays(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	for (const FKaedeOverlayItem& Ov : Session.OverlayItems())
	{
		if (Ov.alpha <= 0.f) continue;
		const FString OvId = UTF8_TO_TCHAR(Ov.id.c_str());
		const FSlateBrush* OvBrush = GetSceneBrush(OvId);
		if (!OvBrush) continue;
		UTexture2D* OvTex = GetSceneTexture(OvId);
		const float OvAspect = (OvTex && OvTex->GetSizeY() > 0)
			? (float)OvTex->GetSizeX() / (float)OvTex->GetSizeY()
			: (LogicalH > 0.f ? (float)LogicalW / (float)LogicalH : 1.7777f);
		const float OH = LogicalH * Ov.scale;
		const float OW = OH * OvAspect;
		const float OX = (LogicalW - OW) * 0.5f + Ov.x;
		const float OY = (LogicalH - OH) * 0.5f + Ov.y;
		FSlateDrawElement::MakeBox(Ctx.Out, Layer, Ctx.SceneRect(OX, OY, OW, OH), OvBrush,
			ESlateDrawEffect::None, FLinearColor(1.f, 1.f, 1.f, Ov.alpha));
	}
}

// オート/スキップのモードバッジ（右上・箱は Layer・字は Layer+1）。本文中のみ。撮影ではモード off なので golden 不変。
void SKaedeMomijiUIWidget::PaintModeBadge(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	if (Screen != EScreen::Playing || !OverlayName.IsEmpty() || (!bAutoMode && !bSkipMode)) return;
	const float Scale = Ctx.Scale();
	const FString Badge = bSkipMode ? TEXT("≫ SKIP") : TEXT("▶ AUTO");
	const FSlateFontInfo Font = Ctx.Font(true, Ctx.LP(20.f));
	const FVector2D TextSz = MeasureText(Badge, Font);
	const float TextW = (float)TextSz.X / Scale;
	const float PadX = Ctx.LP(16.f), BH = Ctx.LP(34.f), BW = TextW + PadX * 2.f;
	const float BX = LogicalW - BW - Ctx.LP(20.f), BY = Ctx.LP(18.f);
	FSlateDrawElement::MakeBox(Ctx.Out, Layer, Ctx.Rect(BX, BY, BW, BH),
		KaedeUI::GetKaedeRoundedFillBrush(Ctx.LP(8.f) * Scale),
		ESlateDrawEffect::None, FLinearColor(0.08f, 0.06f, 0.05f, 0.82f));
	const float TextH = (float)TextSz.Y / Scale;
	const FPaintGeometry TxtPG = Ctx.Geometry.ToPaintGeometry(
		FVector2f(4000.f, BH * Scale),
		FSlateLayoutTransform(Ctx.ToLocal(BX + PadX, BY + (BH - TextH) * 0.5f
		                                  - KaedeUI::KaedeTextCenterBiasEm * Ctx.LP(20.f))));
	FSlateDrawElement::MakeText(Ctx.Out, Layer + 1, TxtPG, Badge, Font,
		ESlateDrawEffect::None, ThemeColor(UiThemeCurrent.accent));
}

// END 画面（web EndScreen ミラー・Layer..Layer+2）: シナリオ完了後、直前のシーンを暗幕で覆う。
void SKaedeMomijiUIWidget::PaintEndScreen(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	FillRect(Ctx, Layer, 0.f, 0.f, LogicalW, LogicalH, FLinearColor(0.f, 0.f, 0.f, 0.8f));
	// END（白・太字・大・中央・33%H）
	PaintCenteredText(Ctx, Layer + 1, TEXT("END"), Ctx.Font(true, Ctx.LP(64.f)),
		LogicalH * 0.33f - Ctx.LP(36.f), Ctx.LP(72.f), FLinearColor::White);
	// 「タイトルに戻る」ボタン（web: 0x334455・52%H）
	const float BW = Ctx.LP(320.f), BH = Ctx.LP(54.f);
	const FString Label = bMultiProject
		? TEXT("作品選択に戻る  ▶  クリック / Enter")
		: TEXT("タイトルに戻る  ▶  クリック / Enter");
	PaintButton(Ctx, Layer + 1, (LogicalW - BW) * 0.5f, LogicalH * 0.52f, BW, BH,
		FLinearColor(0.200f, 0.267f, 0.333f, 0.95f), Label, Ctx.Font(false, LogicalFontSize), LogicalFontSize);
}

// オーバーレイ（メニュー/設定/目次/セーブ/ロード/解説書）。最前面に描き、ヒットを収集。次の空き層を返す。
int32 SKaedeMomijiUIWidget::PaintOverlay(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	OverlayHits.Reset();
	if (OverlayName.IsEmpty()) return Layer;
	const TArray<KaedeUI::FKaedeDrawCmd> OvCmds = KaedeUI::ComputeDrawList(
		BuildUiDisplayTree(OverlayTree), LogicalW, LogicalH, Ctx.Measure, &OverlayHits, &UiThemeCurrent);
	return KaedeVn::DrawKaedeCmds(OvCmds, Ctx.Geometry, Ctx.Box, Ctx.Out, Layer, (float)LogicalFontSize);
}

// フォーカスリング（Layer）・入力ガイド（Layer+1）・トースト（Layer+2..+3）。
// リングはアクティブな focus 集合（オーバーレイ > 宣言的タイトル）の focused ボタンへ。本編の選択肢の
// リングは PaintPlayScreen が描く。リングと入力ガイドはゲームパッド/キーボード操作中（bFocusVisible）だけ。
void SKaedeMomijiUIWidget::PaintFocusGuideToast(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	EnsureFocusContext();
	if (bFocusVisible)
	{
		FString Key;
		if (const TArray<KaedeUI::FKaedeHit>* Active = ActiveFocusHits(Key))
		{
			if (Active->IsValidIndex(FocusedHit) && (*Active)[FocusedHit].bFocusable)
				PaintFocusRing(Ctx, (*Active)[FocusedHit], Layer);
		}
		PaintInputGuide(Ctx, Layer + 1);
	}
	PaintToast(Ctx, Layer + 2);
}

// フォーカスリング（テーマの accent の枠）。選択肢とオーバーレイ/タイトルのボタンで同じ意匠。
void SKaedeMomijiUIWidget::PaintFocusRing(const KaedeVn::FVnPaintContext& Ctx, const KaedeUI::FKaedeHit& H, int32 Layer) const
{
	const float Inset = Ctx.LP(3.f);
	KaedeVn::DrawRectFrame(Ctx.Geometry, Ctx.Box, Ctx.Out, Layer,
		H.X - Inset, H.Y - Inset, H.W + Inset * 2.f, H.H + Inset * 2.f,
		FMath::Max(2.f, Ctx.LP(3.f) * Ctx.Scale()), ThemeColor(UiThemeCurrent.accent));
}

// 入力ガイド（動的）: 最後に使ったデバイスで決定/戻るの記号を切替表示（入力設計方針 §15）。
// ボタン記号は画像に焼かず描画テキスト（Switch 必須。ゲームパッド=[A]/[B]・キーボード=[Enter]/[Esc]）。
void SKaedeMomijiUIWidget::PaintInputGuide(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	const bool bPad = (LastInputDevice == EInputDevice::Gamepad);
	FString Guide = bPad ? TEXT("[A] 決定") : TEXT("[Enter] 決定");
	if (!OverlayName.IsEmpty())   // 戻れる文脈（オーバーレイ）でのみキャンセルを出す
		Guide += bPad ? TEXT("     [B] 戻る") : TEXT("     [Esc] 戻る");
	PaintCenteredText(Ctx, Layer, Guide, Ctx.Font(false, Ctx.LP(18.f)),
		LogicalH - Ctx.LP(30.f), Ctx.LP(24.f), FLinearColor(0.85f, 0.82f, 0.75f, 0.9f));
}

// トースト（セーブ/ロード結果等の一時メッセージ。箱は Layer・字は Layer+1）。
void SKaedeMomijiUIWidget::PaintToast(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	if (ToastTimer <= 0.f || ToastMsg.IsEmpty()) return;
	const float Scale = Ctx.Scale();
	const float Fade = FMath::Clamp(ToastTimer / 0.5f, 0.f, 1.f);  // 末尾 0.5s でフェードアウト
	const FSlateFontInfo Font = Ctx.Font(true, LogicalFontSize);
	const FVector2D TextSz = MeasureText(ToastMsg, Font);
	const float TextW = (float)TextSz.X;
	const float BoxW = TextW / Scale + Ctx.LP(48.f);      // 論理幅
	const float BoxH = Ctx.LP(40.f);
	const float BoxX = (LogicalW - BoxW) * 0.5f;
	const float BoxY = Ctx.LP(28.f);
	FSlateDrawElement::MakeBox(Ctx.Out, Layer, Ctx.Rect(BoxX, BoxY, BoxW, BoxH),
		KaedeUI::GetKaedeRoundedFillBrush(Ctx.LP(10.f) * Scale),
		ESlateDrawEffect::None, FLinearColor(0.08f, 0.06f, 0.05f, 0.86f * Fade));
	// 縦は実フォント高でセンタリング + 字面補正（KaedeTextCenterBiasEm 参照）。
	const float TextH = (float)TextSz.Y;
	const FPaintGeometry TextPG = Ctx.Geometry.ToPaintGeometry(
		FVector2f(4000.f, BoxH * Scale),
		FSlateLayoutTransform(Ctx.ToLocal(BoxX + (BoxW - TextW / Scale) * 0.5f,
		                                  BoxY + (BoxH - TextH / Scale) * 0.5f
		                                  - KaedeUI::KaedeTextCenterBiasEm * LogicalFontSize)));
	FSlateDrawElement::MakeText(Ctx.Out, Layer + 1, TextPG, ToastMsg, Font,
		ESlateDrawEffect::None, FLinearColor(0.95f, 0.91f, 0.85f, Fade));
}

// マスクと全画面エフェクト（最前面）。どちらも揺れの影響を受けてはいけない（隙間が出る）ので、
// アロット領域全面を直接塗る。
void SKaedeMomijiUIWidget::PaintScreenEffects(const KaedeVn::FVnPaintContext& Ctx, int32 Layer) const
{
	const FSlateBrush* WhiteBrush = FCoreStyle::Get().GetBrush("WhiteBrush");
	const FPaintGeometry Whole = Ctx.Geometry.ToPaintGeometry(Ctx.Geometry.GetLocalSize(), FSlateLayoutTransform());
	// マスク（MASK_SET / MASK_CLEAR）: FADE_BLACK と違い MASK_CLEAR まで維持し続ける全画面カラー。任意色を取れる。
	// 本文・UI より上に被せる（Tyrano [mask] と同じ）。
	if (const float MaskA = Session.MaskAlpha(); MaskA > 0.f)
	{
		const FString Hex = Session.MaskColor();
		FLinearColor Col = FLinearColor::Black;
		if (Hex.StartsWith(TEXT("#"))) Col = FLinearColor(FColor::FromHex(Hex));
		Col.A = MaskA;
		FSlateDrawElement::MakeBox(Ctx.Out, Layer, Whole, WhiteBrush, ESlateDrawEffect::None, Col);
	}
	// 全画面オーバーレイ（FLASH / FADE_BLACK / FADE_WHITE / BLACK_IN / WHITE_IN）: 暗転・閃光は
	// 「画面が見えなくなる」演出なので、本文もオーバーレイUIも含めて最前面に被せる。
	if (const float OvA = Session.OverlayAlpha(); OvA > 0.f)
	{
		const FLinearColor Col = Session.OverlayIsWhite()
			? FLinearColor(1.f, 1.f, 1.f, OvA) : FLinearColor(0.f, 0.f, 0.f, OvA);
		FSlateDrawElement::MakeBox(Ctx.Out, Layer, Whole, WhiteBrush, ESlateDrawEffect::None, Col);
	}
}

FReply SKaedeMomijiUIWidget::OnMouseMove(const FGeometry& /*MyGeometry*/, const FPointerEvent& /*MouseEvent*/)
{
	// マウス操作 → デバイスを MouseKeyboard に、フォーカスリング/入力ガイドを消す（Hover 主体へ）。
	LastInputDevice = EInputDevice::MouseKeyboard;
	if (bFocusVisible) { bFocusVisible = false; Invalidate(EInvalidateWidgetReason::Paint); }
	return FReply::Unhandled();
}

FReply SKaedeMomijiUIWidget::OnMouseButtonDown(const FGeometry& MyGeometry, const FPointerEvent& MouseEvent)
{
	const bool bLeft  = MouseEvent.GetEffectingButton() == EKeys::LeftMouseButton;
	const bool bRight = MouseEvent.GetEffectingButton() == EKeys::RightMouseButton;
	if (!bLeft && !bRight)
	{
		return FReply::Unhandled();
	}

	// マウスクリック → デバイス切替＋リング非表示（キーボード/パッドの方向フォーカスとは別状態）。
	LastInputDevice = EInputDevice::MouseKeyboard;
	bFocusVisible = false;

	// クリック位置をローカル → 論理座標へ（OnPaint と同じレターボックス変換）。
	const KaedeVn::FKaedeLetterbox Box = KaedeVn::FKaedeLetterbox::Fit(MyGeometry.GetLocalSize(), LogicalW, LogicalH);
	if (!Box.IsValid()) return FReply::Handled();
	const FVector2f Logical = Box.ToLogical(FVector2f(MyGeometry.AbsoluteToLocal(MouseEvent.GetScreenSpacePosition())));
	const float Lx = Logical.X;
	const float Ly = Logical.Y;

	// 右クリック: オーバーレイ表示中は「戻る」、本編中はメニューを開く（VN 標準操作）。
	if (bRight)
	{
		if (!OverlayName.IsEmpty())            { CloseOverlay(); return FReply::Handled(); }
		if (Screen == EScreen::Playing)        { OpenOverlay(TEXT("menu")); return FReply::Handled(); }
		return FReply::Handled();
	}

	// オーバーレイ表示中はモーダル: 最前面ヒットのみ処理し、外側クリックは吸収する。
	if (!OverlayName.IsEmpty())
	{
		for (int32 i = OverlayHits.Num() - 1; i >= 0; --i)   // 描画順=奥→手前。後ろから見る。
		{
			const KaedeUI::FKaedeHit& H = OverlayHits[i];
			if (KaedeVn::HitContains(H, Lx, Ly))
			{
				if (H.Action.IsEmpty()) return FReply::Handled();  // Modal backdrop 等の吸収
				const float RelX = H.W > 0.f ? FMath::Clamp((Lx - H.X) / H.W, 0.f, 1.f) : 0.f;
				HandleUiAction(H.Action, RelX);
				return FReply::Handled();
			}
		}
		return FReply::Handled();
	}

	// タイトル（title.json）: ボタンのヒットだけに反応する。
	if (Screen == EScreen::Title && bTitleTreeLoaded)
	{
		for (int32 i = TitleHits.Num() - 1; i >= 0; --i)
		{
			const KaedeUI::FKaedeHit& H = TitleHits[i];
			if (KaedeVn::HitContains(H, Lx, Ly))
			{
				const float RelX = H.W > 0.f ? FMath::Clamp((Lx - H.X) / H.W, 0.f, 1.f) : 0.f;
				HandleUiAction(H.Action, RelX);
				return FReply::Handled();
			}
		}
		return FReply::Handled();
	}

	// タイトル（フォールバック）/ END 画面は、画面のどこをクリックしても遷移する。
	if (Screen == EScreen::Title) { BeginScenario(); return FReply::Handled(); }
	if (Screen == EScreen::End)   { ReturnToTitle(); return FReply::Handled(); }

	// 作品選択画面: プロジェクトボタンに当たったら選択。
	if (Screen == EScreen::Select)
	{
		for (int32 i = 0; i < ProjectHits.Num(); ++i)
		{
			if (KaedeVn::HitContains(ProjectHits[i], Lx, Ly))
			{
				SelectProject(i);
				return FReply::Handled();
			}
		}
		return FReply::Handled();
	}

	// 選択肢ボタンに当たったか？（前フレーム OnPaint が収集した CachedHits）
	const int32 Choice = KaedeVn::ChoiceIndexAt(CachedHits, Lx, Ly);
	if (Choice >= 0)
	{
		Session.SelectChoice(Choice);
		return FReply::Handled();
	}

	// それ以外はテキスト送り。
	UE_LOG(LogKaedeVn, Display, TEXT("[kaedevn-face] click -> advance text (history=%d)"), (int32)Session.History().size());
	Session.HandleClick();
	return FReply::Handled();
}

// ===== Focus 一般化（オーバーレイ/タイトルの方向入力。純関数 BuildFocusNav を VN へ適用）=====

// アクティブな focus 集合を返す（モーダルのオーバーレイが最優先＝背面は操作不可、次いで宣言的タイトル）。
// 本編（選択肢）・作品選択・タイトルフォールバックは nullptr（呼び出し側の従来処理へ委ねる）。
TArray<KaedeUI::FKaedeHit>* SKaedeMomijiUIWidget::ActiveFocusHits(FString& OutKey) const
{
	if (!OverlayName.IsEmpty())                         { OutKey = TEXT("ov:") + OverlayName; return &OverlayHits; }
	if (Screen == EScreen::Title && bTitleTreeLoaded)   { OutKey = TEXT("title");            return &TitleHits; }
	OutKey.Reset();
	return nullptr;
}

// アクティブ集合の Focus Graph を（そのフレームの hits から）作り直し、集合が変わったら先頭 focusable へ。
// OnPaint と各入力ハンドラの双方から呼べるよう const（フォーカス状態は mutable）。
void SKaedeMomijiUIWidget::EnsureFocusContext() const
{
	FString Key;
	TArray<KaedeUI::FKaedeHit>* Active = ActiveFocusHits(Key);
	if (!Active)
	{
		FocusContextKey.Reset();
		FocusNav.Reset();
		FocusedHit = -1;
		return;
	}

	const bool bContextChanged = (Key != FocusContextKey);
	FocusNav = KaedeUI::BuildFocusNav(*Active);   // 幾何から毎回生成（内容変化でも index 整合を保つ・純関数で安価）
	FocusContextKey = Key;

	auto FirstFocusable = [&]() -> int32
	{
		for (int32 i = 0; i < Active->Num(); ++i) if ((*Active)[i].bFocusable) return i;
		return -1;
	};
	if (bContextChanged || !Active->IsValidIndex(FocusedHit) || !(*Active)[FocusedHit].bFocusable)
		FocusedHit = FirstFocusable();
}

bool SKaedeMomijiUIWidget::MoveVnFocus(int32 dx, int32 dy)
{
	FString Key;
	TArray<KaedeUI::FKaedeHit>* Active = ActiveFocusHits(Key);
	if (!Active) return false;   // 本編/選択肢/作品選択は呼び出し側の従来処理へ

	EnsureFocusContext();
	bFocusVisible = true;

	// フォーカス中がスライダーで左右入力なら、フォーカス移動ではなく値を増減する（ゲームパッドで音量等を調整）。
	if (dx != 0 && Active->IsValidIndex(FocusedHit))
	{
		const KaedeUI::FKaedeHit& H = (*Active)[FocusedHit];
		FString SliderVar;
		if (KaedeUI::TakePrefix(H.Action, TEXT("slider:"), SliderVar))
		{
			const std::string VarKey = TCHAR_TO_UTF8(*SliderVar);
			const double Cur = UiVars.count(VarKey) ? UiVars[VarKey] : 0.5;
			const double Next = FMath::Clamp(Cur + (dx > 0 ? 0.1 : -0.1), 0.0, 1.0);
			HandleUiAction(H.Action, (float)Next);   // slider の RelX は絶対値として扱われる
			Invalidate(EInvalidateWidgetReason::Paint);
			return true;
		}
	}

	if (FocusNav.IsValidIndex(FocusedHit))
	{
		const KaedeUI::FKaedeFocusNav& N = FocusNav[FocusedHit];
		int32 Next = -1;
		if (dy < 0) Next = N.Up; else if (dy > 0) Next = N.Down;
		else if (dx < 0) Next = N.Left; else if (dx > 0) Next = N.Right;
		if (Active->IsValidIndex(Next)) FocusedHit = Next;
	}
	Invalidate(EInvalidateWidgetReason::Paint);
	return true;   // アクティブ集合がある = このイベントは focus 側で消費
}

bool SKaedeMomijiUIWidget::ConfirmVnFocus()
{
	FString Key;
	TArray<KaedeUI::FKaedeHit>* Active = ActiveFocusHits(Key);
	if (!Active) return false;

	EnsureFocusContext();
	bFocusVisible = true;
	Invalidate(EInvalidateWidgetReason::Paint);
	if (!Active->IsValidIndex(FocusedHit)) return true;   // 集合はあるが空 → 消費のみ
	const KaedeUI::FKaedeHit& H = (*Active)[FocusedHit];
	if (H.Action.IsEmpty()) return true;                  // backdrop 等は吸収
	// スライダーは決定で右寄り（+0.6）へ（左右で微調整できる。Canvas と同じ簡易操作）。
	const float RelX = KaedeUI::IsSliderAction(H.Action) ? 0.6f : 0.f;
	HandleUiAction(H.Action, RelX);
	return true;
}

void SKaedeMomijiUIWidget::InputConfirm()
{
	if (ConfirmVnFocus()) return;   // オーバーレイ/タイトルの focused ボタンを実行
	// 作品選択画面ではフォーカス中の作品を決定。
	if (Screen == EScreen::Select) { SelectProject(SelectedProject); return; }
	// タイトルフォールバック（title.json 無し）/ END 画面は決定キーで遷移。
	if (Screen == EScreen::Title) { BeginScenario(); return; }
	if (Screen == EScreen::End)   { ReturnToTitle(); return; }
	Session.Confirm();
}
void SKaedeMomijiUIWidget::InputFocusNext()
{
	if (MoveVnFocus(0, 1)) return;   // オーバーレイ/タイトルの方向移動を優先
	// 作品選択画面では次の作品へフォーカス移動（末尾で止める）。
	if (Screen == EScreen::Select)
	{
		if (Projects.Num() > 0) SelectedProject = FMath::Clamp(SelectedProject + 1, 0, Projects.Num() - 1);
		return;
	}
	Session.FocusNext();
}
void SKaedeMomijiUIWidget::InputFocusPrev()
{
	if (MoveVnFocus(0, -1)) return;
	if (Screen == EScreen::Select)
	{
		if (Projects.Num() > 0) SelectedProject = FMath::Clamp(SelectedProject - 1, 0, Projects.Num() - 1);
		return;
	}
	Session.FocusPrev();
}
void SKaedeMomijiUIWidget::InputFocusLeft()  { MoveVnFocus(-1, 0); }
void SKaedeMomijiUIWidget::InputFocusRight() { MoveVnFocus(1, 0); }
void SKaedeMomijiUIWidget::InputCancel()
{
	// オーバーレイ表示中は閉じる。本編中はメニューを開く（マウス右クリックのゲームパッド版）。
	if (!OverlayName.IsEmpty())     { CloseOverlay(); Invalidate(EInvalidateWidgetReason::Paint); return; }
	if (Screen == EScreen::Playing) { OpenOverlay(TEXT("menu")); Invalidate(EInvalidateWidgetReason::Paint); return; }
}
void SKaedeMomijiUIWidget::NotifyInputDevice(bool bGamepad)
{
	// PlayerController 経由 = キーボード/ゲームパッド操作。リング/入力ガイドを表示に。
	LastInputDevice = bGamepad ? EInputDevice::Gamepad : EInputDevice::MouseKeyboard;
	if (!bFocusVisible) { bFocusVisible = true; Invalidate(EInvalidateWidgetReason::Paint); }
}

void SKaedeMomijiUIWidget::InputAuto()
{
	if (Screen != EScreen::Playing || !OverlayName.IsEmpty()) return;   // 本文中のみ
	bAutoMode = !bAutoMode;
	if (bAutoMode) bSkipMode = false;   // オートとスキップは排他
	AutoAccum = 0.f;
	Invalidate(EInvalidateWidgetReason::Paint);
}
void SKaedeMomijiUIWidget::InputSkip()
{
	if (Screen != EScreen::Playing || !OverlayName.IsEmpty()) return;
	bSkipMode = !bSkipMode;
	if (bSkipMode) bAutoMode = false;
	SkipAccum = 0.f;
	Invalidate(EInvalidateWidgetReason::Paint);
}
void SKaedeMomijiUIWidget::InputMenu()
{
	if (Screen == EScreen::Playing && OverlayName.IsEmpty())
	{
		OpenOverlay(TEXT("menu"));
		Invalidate(EInvalidateWidgetReason::Paint);
	}
}

// Tick からオート/スキップの自動送りを駆動する。選択肢では止まり、表示途中はオートを待たせる。
void SKaedeMomijiUIWidget::DriveAutoSkip(float DeltaSec)
{
	if (!bAutoMode && !bSkipMode) return;
	const kaedevn::GameScreenState& St = Session.State();
	if (St.waitingForChoice) { AutoAccum = SkipAccum = 0.f; return; }   // 選択肢で停止（誤操作防止）
	const bool bWaiting = St.waitingForClick || St.waitingForPage;
	if (!bWaiting) { AutoAccum = 0.f; return; }

	if (bSkipMode)
	{
		// waitingForClick/Page の間は最短間隔で送る（handleClick が表示途中は全表示→次で送る）。
		SkipAccum += DeltaSec;
		if (SkipAccum >= SkipStepSec) { SkipAccum = 0.f; Session.HandleClick(); }
		return;
	}
	// オート: 本文が全表示されてから AutoDelaySec 待って送る。
	const bool bRevealed = !St.text.has_value()
		|| St.text->displayedChars >= (float)St.text->content.size();
	if (!bRevealed) { AutoAccum = 0.f; return; }
	AutoAccum += DeltaSec;
	if (AutoAccum >= AutoDelaySec) { AutoAccum = 0.f; Session.HandleClick(); }
}

void SKaedeMomijiUIWidget::ShowToast(const FString& Msg)
{
	ToastMsg = Msg;
	ToastTimer = 2.0f;  // 秒
}
