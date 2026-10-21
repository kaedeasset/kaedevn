// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "Modules/ModuleManager.h"
#include "Misc/Paths.h"
#include "ShaderCore.h"
#include "Interfaces/IPluginManager.h"   // プラグイン化: /Kaede をプラグインの Shaders に対応付ける
#include "PluginDescriptor.h"

namespace
{
	// このモジュールを持つプラグイン（開発中は Kaedevn、製品は別の名前なので、名前で探さない）
	TSharedPtr<IPlugin> FindOwningPlugin(const TCHAR* ModuleName)
	{
		for (const TSharedRef<IPlugin>& P : IPluginManager::Get().GetEnabledPlugins())
			for (const FModuleDescriptor& M : P->GetDescriptor().Modules)
				if (M.Name == ModuleName) return P;
		return nullptr;
	}
}

// シェーダ仮想ディレクトリ /Kaede を <Plugin>/Shaders に対応付ける。
// グローバルシェーダは起動時にコンパイルされるため PostConfigInit でマップする。
// （プラグイン化前は <Project>/Shaders だったが、Plugins/KaedeVN/Shaders へ移設）
class FKaedeShadersModule : public IModuleInterface
{
public:
	virtual void StartupModule() override
	{
		const TSharedPtr<IPlugin> Plugin = FindOwningPlugin(TEXT("KaedeShaders"));
		const FString ShaderDir = FPaths::Combine(
			Plugin.IsValid() ? Plugin->GetBaseDir() : FPaths::ProjectDir(), TEXT("Shaders"));
		if (!AllShaderSourceDirectoryMappings().Contains(TEXT("/Kaede")))
		{
			AddShaderSourceDirectoryMapping(TEXT("/Kaede"), ShaderDir);
		}
	}
};

IMPLEMENT_MODULE(FKaedeShadersModule, KaedeShaders);
