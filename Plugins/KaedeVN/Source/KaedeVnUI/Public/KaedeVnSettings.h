// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeVnSettings.h — KaedeVN の設定（Project Settings > Plugins > KaedeVN）と、作品の置き場を求める 1 か所の関数。
//
// 製品のコードは作品の置き場（今のこのリポジトリでは Game/）を直に書かない。全部 KaedeVn::GetWorkRoot() から求める。
// 既定値はプラグインの Config/DefaultKaedeVN.ini の 1 か所に書き（コードに作品の置き場の文字を書かない）、プロジェクトは Config/DefaultKaedeVN.ini で上書きする。
// 設計: Docs/Guides/Working/product-split-design.md §5.5（分割 S4・2026-10-14。既定値を ini へ移したのは S5）。
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "KaedeVnSettings.generated.h"

UCLASS(config = KaedeVN, defaultconfig, meta = (DisplayName = "KaedeVN"))
class KAEDEVNUI_API UKaedeVnSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UKaedeVnSettings();

	virtual FName GetCategoryName() const override { return TEXT("Plugins"); }

	// 作品のデータ（projects/・works/・ui/・assets.json・シナリオ）の置き場。プロジェクトの直下からの相対（絶対でもよい）。空ならプロジェクトの直下。
	// 書き出しでは、この置き場を UFS に入れる（DirectoriesToAlwaysStageAsUFS。KaedeVN の README）。
	UPROPERTY(config, EditAnywhere, Category = "Work")
	FString WorkRoot;

	// ノベルエディタのプレビューで開くマップ（例 /Game/Map/Lvl_Sample2D）。空なら今開いているマップのまま。
	UPROPERTY(config, EditAnywhere, Category = "Work")
	FString PreviewMap;
};

namespace KaedeVn
{
	// 作品の置き場の絶対パス（末尾の / なし）。UKaedeVnSettings::WorkRoot をプロジェクトの直下から解く。
	KAEDEVNUI_API FString GetWorkRoot();
}
