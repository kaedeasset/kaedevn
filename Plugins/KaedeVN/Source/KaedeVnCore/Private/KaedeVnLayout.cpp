// Copyright (c) 2026 kaedeasset. Licensed under the MIT License.
#include "KaedeVnLayout.h"

namespace KaedeVn
{
	FKaedeCharPlacement CharPlacement(float LogicalW, float LogicalH)
	{
		FKaedeCharPlacement P;
		P.Height = LogicalH * (700.f / 720.f);
		P.SideMargin = LogicalW * (60.f / 1280.f);
		return P;
	}
}
