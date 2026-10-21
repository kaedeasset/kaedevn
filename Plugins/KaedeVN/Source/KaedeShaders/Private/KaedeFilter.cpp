// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
// KaedeFilter.cpp — 背景へ .usf のスクリーンフィルタを掛けてRTへ書き出す。
//
// SCREEN_FILTER（朝もや・夕焼け等）の実処理。呼び出し側（SKaedeMomijiUIWidget）が
// 論理解像度サイズの RT を用意し、ここが背景テクスチャをフィルタして書き込む。
// **RT は論理解像度で作られる**ので、1080p 論理なら等倍で鮮明、720p 論理なら
// 拡大されて甘くなる。
//
// 概要記述: Claude Opus 5 (1M context) — 2026-07-28
#include "KaedeFilter.h"

#include "GlobalShader.h"
#include "ShaderParameterStruct.h"
#include "RenderGraphBuilder.h"
#include "RenderGraphUtils.h"
#include "PixelShaderUtils.h"
#include "RHIStaticStates.h"
#include "TextureResource.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/Texture.h"

// SCREEN_FILTER 用フルスクリーン pixel shader。
class FKaedeFilterPS : public FGlobalShader
{
public:
	DECLARE_GLOBAL_SHADER(FKaedeFilterPS);
	SHADER_USE_PARAMETER_STRUCT(FKaedeFilterPS, FGlobalShader);

	BEGIN_SHADER_PARAMETER_STRUCT(FParameters, )
		SHADER_PARAMETER_TEXTURE(Texture2D, InputTexture)
		SHADER_PARAMETER_SAMPLER(SamplerState, InputSampler)
		SHADER_PARAMETER(float, Intensity)
		SHADER_PARAMETER(int32, FilterType)
		SHADER_PARAMETER(FVector2f, InvSize)
		RENDER_TARGET_BINDING_SLOTS()
	END_SHADER_PARAMETER_STRUCT()

	static bool ShouldCompilePermutation(const FGlobalShaderPermutationParameters&) { return true; }
};

IMPLEMENT_GLOBAL_SHADER(FKaedeFilterPS, "/Kaede/Private/KaedeFilter.usf", "MainPS", SF_Pixel);

namespace KaedeShaders
{
	void ApplyFilter(UTextureRenderTarget2D* Dest, UTexture* Src, int32 FilterType, float Intensity)
	{
		if (!Dest || !Src || !Dest->GetResource() || !Src->GetResource()) return;

		FTextureResource* DestRes = Dest->GetResource();
		FTextureResource* SrcRes = Src->GetResource();
		const int32 W = Dest->SizeX;
		const int32 H = Dest->SizeY;

		ENQUEUE_RENDER_COMMAND(KaedeFilterCmd)(
			[DestRes, SrcRes, FilterType, Intensity, W, H](FRHICommandListImmediate& RHICmdList)
			{
				FRDGBuilder GraphBuilder(RHICmdList);

				FRDGTextureRef DestTex = RegisterExternalTexture(
					GraphBuilder, DestRes->GetTextureRHI(), TEXT("KaedeFilterDest"));

				FKaedeFilterPS::FParameters* P = GraphBuilder.AllocParameters<FKaedeFilterPS::FParameters>();
				P->InputTexture = SrcRes->GetTextureRHI();
				P->InputSampler = TStaticSamplerState<SF_Bilinear, AM_Clamp, AM_Clamp, AM_Clamp>::GetRHI();
				P->Intensity = Intensity;
				P->FilterType = FilterType;
				P->InvSize = FVector2f(1.f / FMath::Max(1, W), 1.f / FMath::Max(1, H));
				P->RenderTargets[0] = FRenderTargetBinding(DestTex, ERenderTargetLoadAction::ENoAction);

				const FGlobalShaderMap* ShaderMap = GetGlobalShaderMap(GMaxRHIFeatureLevel);
				TShaderMapRef<FKaedeFilterPS> PixelShader(ShaderMap);
				FPixelShaderUtils::AddFullscreenPass(
					GraphBuilder, ShaderMap, RDG_EVENT_NAME("KaedeFilter"),
					PixelShader, P, FIntRect(0, 0, W, H));

				GraphBuilder.Execute();
			});
	}
}
