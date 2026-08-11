from typing import Literal, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


app = FastAPI(
    title="VibeSpace Backend API",
    version="0.1.0",
    description="核心後端：接收環境聲音分析資料與空間參數，回傳建議混音參數。",
)

# Demo 階段允許瀏覽器前端直接呼叫。
# 正式部署時可改成只允許實際前端網域。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SpaceSettings(BaseModel):
    spaceSize: Literal["small", "medium", "large"]
    ceilingMaterial: Literal["steel", "concrete", "wood"]
    airConditioning: Literal["split", "central"]


class SoundAnalysis(BaseModel):
    # 0.0 ~ 1.0 的正規化環境音量。
    # 未來 audio-engine 若採 RMS，可直接把正規化後 RMS 放在此欄位。
    level: float = Field(ge=0.0, le=1.0)

    # 可選欄位，若前端之後有提供 dB 值可一起傳。
    db: Optional[float] = None

    # 可選欄位，保留給未來 peak meter。
    peak: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class AnalyzeRequest(BaseModel):
    sound: SoundAnalysis
    space: SpaceSettings


class MixRecommendation(BaseModel):
    musicVolume: float = Field(ge=0.0, le=1.0)
    crossfade: float = Field(ge=0.0, le=1.0)
    profile: str
    reason: str


class AnalyzeResponse(BaseModel):
    recommendation: MixRecommendation


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def build_recommendation(sound: SoundAnalysis, space: SpaceSettings) -> MixRecommendation:
    """
    Demo 用規則式核心判斷。

    目前 audio-engine 尚未定案，因此先只依賴一個穩定介面：
    sound.level (0~1)。

    之後若前端補上 RMS / dB / peak，只需擴充此函式，
    API 路徑與 space 資料格式可維持不變。
    """

    # 基礎策略：
    # 環境越吵，背景音樂略微提高；
    # 但保留上限，避免過度拉高音量。
    base_volume = 0.28 + sound.level * 0.42

    # 空間尺寸補償
    size_adjustment = {
        "small": -0.04,
        "medium": 0.00,
        "large": 0.05,
    }[space.spaceSize]

    # 天花板反射特性補償
    ceiling_adjustment = {
        "steel": -0.02,
        "wood": 0.00,
        "concrete": -0.05,
    }[space.ceilingMaterial]

    # 中央空調通常有較穩定底噪，給予小幅補償
    ac_adjustment = 0.03 if space.airConditioning == "central" else 0.00

    music_volume = clamp(
        base_volume + size_adjustment + ceiling_adjustment + ac_adjustment,
        0.15,
        0.82,
    )

    # Crossfade：環境越吵，變化越平緩，避免頻繁切換造成突兀感。
    crossfade = clamp(0.35 + sound.level * 0.45, 0.25, 0.85)

    reflection_score = {
        "small": 1,
        "medium": 2,
        "large": 3,
    }[space.spaceSize] + {
        "steel": 1,
        "wood": 2,
        "concrete": 3,
    }[space.ceilingMaterial]

    if reflection_score >= 5:
        profile = "wide-immersive"
        profile_zh = "寬域沉浸"
    elif reflection_score >= 3:
        profile = "balanced-surround"
        profile_zh = "平衡環繞"
    else:
        profile = "near-field-clear"
        profile_zh = "近場清晰"

    reason = (
        f"環境音量 level={sound.level:.2f}；"
        f"空間模式為「{profile_zh}」，"
        f"依空間大小、天花板材質與空調類型調整背景音量與 Crossfade。"
    )

    return MixRecommendation(
        musicVolume=round(music_volume, 3),
        crossfade=round(crossfade, 3),
        profile=profile,
        reason=reason,
    )


@app.get("/")
def root():
    return {
        "name": "VibeSpace Backend API",
        "status": "ok",
        "docs": "/docs",
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze(payload: AnalyzeRequest):
    return AnalyzeResponse(
        recommendation=build_recommendation(payload.sound, payload.space)
    )
