"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FaceMesh,
  NormalizedLandmark,
  Results as FaceMeshResults,
} from "@mediapipe/face_mesh";

type Answers = Record<string, string[]>;
type Screen = "home" | "quiz" | "confirm" | "look" | "products" | "saved";
type FaceMeshConstructor = typeof import("@mediapipe/face_mesh").FaceMesh;

declare global {
  interface Window {
    FaceMesh?: FaceMeshConstructor;
  }
}

let faceMeshScriptPromise: Promise<FaceMeshConstructor> | null = null;

function loadBrowserFaceMesh() {
  if (window.FaceMesh) return Promise.resolve(window.FaceMesh);
  if (faceMeshScriptPromise) return faceMeshScriptPromise;

  faceMeshScriptPromise = new Promise<FaceMeshConstructor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-fenty-face-mesh="true"]',
    );
    const finish = () => {
      if (window.FaceMesh) resolve(window.FaceMesh);
      else reject(new Error("实时面部追踪器加载失败。"));
    };
    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("实时面部追踪器加载失败。")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "/mediapipe/face_mesh.js";
    script.async = true;
    script.dataset.fentyFaceMesh = "true";
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("实时面部追踪器加载失败。")),
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((error) => {
    faceMeshScriptPromise = null;
    throw error;
  });

  return faceMeshScriptPromise;
}

type SavedLook = {
  id: number;
  name: string;
  note: string;
  answers: Answers;
  eyeIntensity?: number;
  blushIntensity?: number;
  glowIntensity?: number;
  intensity?: number;
};

type BlushPalette = {
  liveStops: Array<[number, string]>;
  sampleCore: string;
  sampleMid: string;
  sampleEdge: string;
};

const blushPalettes: Record<
  "blackCherry" | "gilded" | "bareGold" | "softFocus",
  BlushPalette
> = {
  blackCherry: {
    liveStops: [
      [0, "rgba(105, 28, 53, 0.46)"],
      [0.18, "rgba(112, 34, 58, 0.42)"],
      [0.4, "rgba(126, 45, 67, 0.3)"],
      [0.64, "rgba(139, 58, 76, 0.15)"],
      [0.84, "rgba(145, 67, 83, 0.05)"],
      [1, "rgba(145, 67, 83, 0)"],
    ],
    sampleCore: "rgba(105, 28, 53, 0.48)",
    sampleMid: "rgba(126, 45, 67, 0.2)",
    sampleEdge: "rgba(145, 67, 83, 0.035)",
  },
  gilded: {
    liveStops: [
      [0, "rgba(145, 57, 45, 0.44)"],
      [0.18, "rgba(157, 65, 50, 0.4)"],
      [0.4, "rgba(174, 79, 61, 0.28)"],
      [0.64, "rgba(186, 95, 72, 0.14)"],
      [0.84, "rgba(195, 110, 84, 0.047)"],
      [1, "rgba(195, 110, 84, 0)"],
    ],
    sampleCore: "rgba(145, 57, 45, 0.45)",
    sampleMid: "rgba(174, 79, 61, 0.19)",
    sampleEdge: "rgba(195, 110, 84, 0.032)",
  },
  bareGold: {
    liveStops: [
      [0, "rgba(174, 76, 67, 0.42)"],
      [0.18, "rgba(186, 86, 74, 0.38)"],
      [0.4, "rgba(201, 102, 87, 0.27)"],
      [0.64, "rgba(214, 121, 101, 0.135)"],
      [0.84, "rgba(221, 137, 115, 0.045)"],
      [1, "rgba(221, 137, 115, 0)"],
    ],
    sampleCore: "rgba(174, 76, 67, 0.43)",
    sampleMid: "rgba(201, 102, 87, 0.18)",
    sampleEdge: "rgba(221, 137, 115, 0.03)",
  },
  softFocus: {
    liveStops: [
      [0, "rgba(151, 74, 91, 0.4)"],
      [0.18, "rgba(163, 82, 99, 0.36)"],
      [0.4, "rgba(180, 99, 114, 0.255)"],
      [0.64, "rgba(193, 118, 130, 0.128)"],
      [0.84, "rgba(202, 136, 146, 0.042)"],
      [1, "rgba(202, 136, 146, 0)"],
    ],
    sampleCore: "rgba(151, 74, 91, 0.41)",
    sampleMid: "rgba(180, 99, 114, 0.17)",
    sampleEdge: "rgba(202, 136, 146, 0.028)",
  },
};

const recommendedIntensities = {
  eye: 54,
  blush: 48,
  glow: 58,
} as const;

const optionLabels: Record<string, string> = {
  Everyday: "日常",
  Work: "上班",
  Class: "上课",
  "Date night": "约会",
  Dinner: "晚餐",
  "Wedding guest": "婚礼宾客",
  Bridal: "新娘妆",
  Party: "派对",
  Concert: "演唱会",
  Festival: "音乐节",
  Photoshoot: "拍摄",
  "Formal event": "正式场合",
  Vacation: "度假",
  Brunch: "早午餐",
  Interview: "面试",
  "Just experimenting": "尝试新风格",
  Dry: "干性",
  Oily: "油性",
  Combination: "混合性",
  Balanced: "中性",
  Sensitive: "敏感性",
  "Not sure": "不确定",
  "Soft glam": "柔和精致",
  "Clean & minimal": "干净极简",
  Bold: "大胆",
  Romantic: "浪漫",
  Editorial: "杂志感",
  Luminous: "通透光泽",
  "Velvet matte": "丝绒哑光",
  "Fresh-faced": "清新自然",
  Smoky: "烟熏",
  Sculpted: "立体轮廓",
  Playful: "灵动有趣",
  Monochrome: "同色系",
  "Sweet-cool": "甜酷",
  "High-fashion": "高级时装感",
  Sultry: "魅惑",
  Unexpected: "突破常规",
  "Heavy base": "厚重底妆",
  "Matte finish": "全哑光妆效",
  "High shine": "强烈光泽",
  Glitter: "闪粉",
  "Bold lip": "浓艳唇色",
  "Dark eyes": "深色眼妆",
  "False lashes": "假睫毛",
  "Sharp contour": "锐利修容",
  "Bright colour": "鲜艳色彩",
  "Warm tones": "暖色调",
  "Cool tones": "冷色调",
  Fragrance: "香味产品",
  Powder: "粉状产品",
  "Cream products": "膏状产品",
  "Long routine": "繁复步骤",
  "Nothing — surprise me": "没有限制，给我惊喜",
};

const savedLookNames: Record<string, string> = {
  "Gilded After Dark": "鎏金夜色",
  "Black Cherry Velvet": "黑樱桃丝绒",
  "Bare Gold Radiance": "裸金流光",
  "Soft Focus Muse": "柔焦缪斯",
};

const savedLookNotes: Record<string, string> = {
  "A softly sculpted complexion, molten-gold light and a confident smoked eye—edited to feel like you, never like a costume.":
    "柔和雕琢的轮廓、融金般的光泽与自信烟熏眼妆——保留你的本色，而非戴上一副面具。",
  "A breathable skin-first look with diffused definition, a warm wash of gold and a lip that looks naturally amplified.":
    "以轻盈透气的肌肤为主角，搭配柔和轮廓、温暖金调与自然放大的唇色。",
};

const questions = [
  {
    key: "occasion",
    eyebrow: "01 — 此刻",
    title: "这次妆容适合什么场合？",
    hint: "可选择所有符合你情境的选项。",
    options: [
      "Everyday",
      "Work",
      "Class",
      "Date night",
      "Dinner",
      "Wedding guest",
      "Bridal",
      "Party",
      "Concert",
      "Festival",
      "Photoshoot",
      "Formal event",
      "Vacation",
      "Brunch",
      "Interview",
      "Just experimenting",
    ],
  },
  {
    key: "skin",
    eyebrow: "02 — 肌肤",
    title: "你的肤质属于哪一种？",
    hint: "请选择最符合你目前肌肤状态的一项。",
    options: [
      "Dry",
      "Oily",
      "Combination",
      "Balanced",
      "Sensitive",
      "Not sure",
    ],
  },
  {
    key: "feel",
    eyebrow: "03 — 气质",
    title: "你希望最终妆容呈现什么感觉？",
    hint: "可混搭多种氛围，我们会为你取得平衡。",
    options: [
      "Soft glam",
      "Clean & minimal",
      "Bold",
      "Romantic",
      "Editorial",
      "Luminous",
      "Velvet matte",
      "Fresh-faced",
      "Smoky",
      "Sculpted",
      "Playful",
      "Monochrome",
      "Sweet-cool",
      "High-fashion",
      "Sultry",
      "Unexpected",
    ],
  },
  {
    key: "avoid",
    eyebrow: "04 — 边界",
    title: "有什么妆容元素是你想避开的？",
    hint: "我们会从推荐中排除这些元素。",
    options: [
      "Heavy base",
      "Matte finish",
      "High shine",
      "Glitter",
      "Bold lip",
      "Dark eyes",
      "False lashes",
      "Sharp contour",
      "Bright colour",
      "Warm tones",
      "Cool tones",
      "Fragrance",
      "Powder",
      "Cream products",
      "Long routine",
      "Nothing — surprise me",
    ],
  },
];

const products = [
  {
    name: "Pro Filt’r 柔雾持妆粉底液",
    shade: "灵活适配 · 50 色号系列",
    form: "液体",
    use: "从面部中央轻拍薄薄一层，再向外均匀晕开。",
    skin: "混合性 · 油性",
    old: "$40",
    price: "$20",
    why: "适应不同气候的可叠加遮瑕力，让底妆精致，同时保留肌肤的自然立体感。",
    tone: "#d9a06f",
    shape: "bottle",
  },
  {
    name: "Cheeks Out Freestyle 奶油腮红",
    shade: "Petal Poppin’ · 柔粉色",
    form: "膏状",
    use: "轻拍于苹果肌上方，再朝太阳穴方向柔和晕开。",
    skin: "所有肤质",
    price: "$26",
    why: "轻透可叠加的红润感，为妆容注入生气，同时保持自然轻盈。",
    tone: "#e89792",
    shape: "compact",
  },
  {
    name: "Killawatt Freestyle 高光粉",
    shade: "Mean Money / Hu$tla Baby",
    form: "霜粉质地",
    use: "扫过颧骨；想要更强效果时，也可轻压于眼皮。",
    skin: "所有肤质",
    price: "$40",
    why: "可层层叠加的光泽，能从日间微光轻松过渡至耀眼金色。",
    tone: "#d6ae58",
    shape: "compact",
  },
  {
    name: "Gloss Bomb 万用亮泽唇蜜",
    shade: "Fenty Glow · 玫瑰裸色",
    form: "唇蜜",
    use: "直接涂于裸唇，或叠加在柔和勾勒的唇线之上。",
    skin: "所有肤质",
    price: "$23",
    why: "百搭玫瑰裸色光泽提升唇部立体感，又不会抢去眼妆焦点。",
    tone: "#a65b46",
    shape: "gloss",
  },
];

const emptyAnswers: Answers = { occasion: [], skin: [], feel: [], avoid: [] };

function ProductArt({
  product,
  index,
}: {
  product: (typeof products)[number];
  index: number;
}) {
  return (
    <div
      className={`product-art ${product.shape}`}
      style={{ "--tone": product.tone } as React.CSSProperties}
    >
      <span className="art-index">0{index + 1}</span>
      <div className="product-object">
        <b>
          FENTY
          <br />
          BEAUTY
        </b>
      </div>
    </div>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [step, setStep] = useState(0);
  const [editingFromConfirm, setEditingFromConfirm] = useState(false);
  const [savedReturnScreen, setSavedReturnScreen] = useState<Screen>("home");
  const [lookReturnScreen, setLookReturnScreen] = useState<Screen>("confirm");
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [eyeIntensity, setEyeIntensity] = useState(
    recommendedIntensities.eye,
  );
  const [blushIntensity, setBlushIntensity] = useState(
    recommendedIntensities.blush,
  );
  const [glowIntensity, setGlowIntensity] = useState(
    recommendedIntensities.glow,
  );
  const [saved, setSaved] = useState<SavedLook[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(
        localStorage.getItem("fenty-saved-looks") || "[]",
      ) as SavedLook[];
    } catch {
      return [];
    }
  });
  const [notice, setNotice] = useState("");
  const [cameraMode, setCameraMode] = useState<
    "sample" | "consent" | "starting" | "live" | "error"
  >("sample");
  const [cameraError, setCameraError] = useState("");
  const [faceVisible, setFaceVisible] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceMeshRef = useRef<FaceMesh | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const cameraBusyRef = useRef(false);
  const faceVisibleRef = useRef(false);
  const intensityRef = useRef({
    eye: recommendedIntensities.eye / 100,
    blush: recommendedIntensities.blush / 100,
    glow: recommendedIntensities.glow / 100,
  });
  const blushPaletteRef = useRef<BlushPalette>(blushPalettes.softFocus);

  useEffect(() => {
    intensityRef.current = {
      eye: eyeIntensity / 100,
      blush: blushIntensity / 100,
      glow: glowIntensity / 100,
    };
  }, [eyeIntensity, blushIntensity, glowIntensity]);

  const resetIntensities = () => {
    setEyeIntensity(recommendedIntensities.eye);
    setBlushIntensity(recommendedIntensities.blush);
    setGlowIntensity(recommendedIntensities.glow);
  };

  const stopCamera = useCallback(async (returnToSample = true) => {
    if (cameraFrameRef.current !== null) {
      cancelAnimationFrame(cameraFrameRef.current);
      cameraFrameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    const activeFaceMesh = faceMeshRef.current;
    faceMeshRef.current = null;
    if (activeFaceMesh) {
      try {
        await activeFaceMesh.close();
      } catch {}
    }
    cameraBusyRef.current = false;
    faceVisibleRef.current = false;
    setFaceVisible(false);
    if (returnToSample) setCameraMode("sample");
  }, []);

  useEffect(() => {
    if (screen !== "look" && streamRef.current) void stopCamera();
  }, [screen, stopCamera]);

  useEffect(
    () => () => {
      if (cameraFrameRef.current !== null)
        cancelAnimationFrame(cameraFrameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void faceMeshRef.current?.close();
    },
    [],
  );

  const drawCameraFrame = useCallback((results: FaceMeshResults) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth || !video.videoHeight) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr))
      canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(height * dpr))
      canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // A failed overlay must never carry multiply/opacity into the next frame.
    // Reset the complete compositing state before painting the camera image.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.clearRect(0, 0, width, height);

    const scale = Math.max(
      width / video.videoWidth,
      height / video.videoHeight,
    );
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    const offsetX = (width - drawWidth) / 2;
    const offsetY = (height - drawHeight) / 2;

    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
    ctx.restore();

    const landmarks = results.multiFaceLandmarks?.[0];
    const hasFace = Boolean(landmarks?.length);
    if (hasFace !== faceVisibleRef.current) {
      faceVisibleRef.current = hasFace;
      setFaceVisible(hasFace);
    }
    if (!landmarks) return;

    const point = (landmark: NormalizedLandmark) => ({
      x: width - (offsetX + landmark.x * drawWidth),
      y: offsetY + landmark.y * drawHeight,
    });
    const distance = (
      a: { x: number; y: number },
      b: { x: number; y: number },
    ) => Math.hypot(a.x - b.x, a.y - b.y);
    const softGradientEllipse = (
      center: { x: number; y: number },
      radiusX: number,
      radiusY: number,
      rotation: number,
      opacity: number,
      blend: GlobalCompositeOperation,
      stops: Array<[number, string]>,
    ) => {
      if (
        !Number.isFinite(center.x) ||
        !Number.isFinite(center.y) ||
        !Number.isFinite(radiusX) ||
        !Number.isFinite(radiusY) ||
        radiusX <= 0 ||
        radiusY <= 0
      )
        return;
      ctx.save();
      try {
        ctx.globalCompositeOperation = blend;
        ctx.globalAlpha = opacity;
        ctx.translate(center.x, center.y);
        ctx.rotate(rotation);
        ctx.scale(radiusX, radiusY);
        const gradient = ctx.createRadialGradient(
          -0.12,
          -0.12,
          0.04,
          0,
          0,
          1,
        );
        stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      } finally {
        ctx.restore();
      }
    };
    const drawEyeShadow = (upperLidIndexes: number[], intensity: number) => {
      // Follow the complete tracked upper-lid contour, then build a tapered
      // crease above it in the eye's local orientation. This keeps the colour
      // on the eyelid even when the head tilts instead of drawing a flat line.
      const trackedLid = upperLidIndexes.map((index) => landmarks[index]);
      if (
        trackedLid.some(
          (landmark) =>
            !landmark ||
            !Number.isFinite(landmark.x) ||
            !Number.isFinite(landmark.y),
        )
      )
        return;
      const lid = trackedLid.map((landmark) => point(landmark));
      const start = lid[0];
      const end = lid[lid.length - 1];
      const eyeWidth = distance(start, end);
      if (!Number.isFinite(eyeWidth) || eyeWidth < 2) return;
      const axis = {
        x: (end.x - start.x) / eyeWidth,
        y: (end.y - start.y) / eyeWidth,
      };
      let upward = { x: axis.y, y: -axis.x };
      if (upward.y > 0) upward = { x: -upward.x, y: -upward.y };

      const lidCenter = lid[Math.floor(lid.length / 2)];
      const washCenter = {
        x: lidCenter.x + upward.x * eyeWidth * 0.105,
        y: lidCenter.y + upward.y * eyeWidth * 0.105,
      };
      const angle = Math.atan2(axis.y, axis.x);

      ctx.save();
      try {
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.1 + intensity * 0.6;
        ctx.translate(washCenter.x, washCenter.y);
        ctx.rotate(angle);
        ctx.scale(eyeWidth * 0.59, eyeWidth * 0.205);
        const wash = ctx.createRadialGradient(-0.04, 0.02, 0.03, 0, 0, 1);
        wash.addColorStop(0, "rgba(91, 51, 29, 0.78)");
        wash.addColorStop(0.28, "rgba(102, 59, 34, 0.62)");
        wash.addColorStop(0.55, "rgba(117, 73, 45, 0.36)");
        wash.addColorStop(0.78, "rgba(130, 89, 61, 0.13)");
        wash.addColorStop(0.92, "rgba(130, 89, 61, 0.035)");
        wash.addColorStop(1, "rgba(126, 82, 52, 0)");
        ctx.fillStyle = wash;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
      } finally {
        ctx.restore();
      }
    };

    const { eye, blush, glow } = intensityRef.current;
    const faceWidth = distance(point(landmarks[234]), point(landmarks[454]));
    const nose = point(landmarks[1]);
    drawEyeShadow([33, 246, 161, 160, 159, 158, 157, 173, 133], eye);
    drawEyeShadow([362, 398, 384, 385, 386, 387, 388, 466, 263], eye);

    const blushCenters = [205, 425].map((index) => {
      const tracked = point(landmarks[index]);
      const outward = Math.sign(tracked.x - nose.x) || 1;
      return {
        x: tracked.x + outward * faceWidth * 0.02,
        y: tracked.y + faceWidth * 0.035,
      };
    });

    const blushPalette = blushPaletteRef.current;
    blushCenters.forEach((center) => {
      softGradientEllipse(
        center,
        faceWidth * 0.185,
        faceWidth * 0.155,
        0,
        0.14 + blush * 0.7,
        "multiply",
        blushPalette.liveStops,
      );
    });

    blushCenters.forEach((blushCenter) => {
      const outward = Math.sign(blushCenter.x - nose.x) || 1;
      const center = {
        x: blushCenter.x + outward * faceWidth * 0.02,
        y: blushCenter.y - faceWidth * 0.145,
      };
      softGradientEllipse(
        center,
        faceWidth * 0.215,
        faceWidth * 0.105,
        outward < 0 ? 0.22 : -0.22,
        0.06 + glow * 0.5,
        "screen",
        [
          [0, "rgba(255, 224, 164, 0.52)"],
          [0.18, "rgba(251, 217, 151, 0.48)"],
          [0.4, "rgba(247, 207, 132, 0.32)"],
          [0.64, "rgba(238, 187, 102, 0.14)"],
          [0.84, "rgba(238, 187, 102, 0.04)"],
          [1, "rgba(238, 187, 102, 0)"],
        ],
      );
    });
  }, []);

  const startCamera = useCallback(async () => {
    setCameraMode("starting");
    setCameraError("");
    try {
      const FaceMeshModel = await loadBrowserFaceMesh();
      const faceMesh = new FaceMeshModel({
        locateFile: (file) => `/mediapipe/${file}`,
      });
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.65,
        minTrackingConfidence: 0.65,
      });
      faceMesh.onResults(drawCameraFrame);
      await faceMesh.initialize();
      faceMeshRef.current = faceMesh;

      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error("此浏览器不支持摄像头访问。");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("摄像头预览无法启动。");
      video.srcObject = stream;
      await video.play();
      setCameraMode("live");

      const trackFrame = async () => {
        if (!faceMeshRef.current || !videoRef.current) return;
        if (!cameraBusyRef.current && videoRef.current.readyState >= 2) {
          cameraBusyRef.current = true;
          try {
            await faceMeshRef.current.send({ image: videoRef.current });
          } catch {
          } finally {
            cameraBusyRef.current = false;
          }
        }
        cameraFrameRef.current = requestAnimationFrame(trackFrame);
      };
      cameraFrameRef.current = requestAnimationFrame(trackFrame);
    } catch (error) {
      await stopCamera(false);
      const message =
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "未获得摄像头权限，你仍可使用示范模特继续体验。"
          : error instanceof Error
            ? error.message
            : "摄像头无法启动。";
      setCameraError(message);
      setCameraMode("error");
    }
  }, [drawCameraFrame, stopCamera]);

  const look = useMemo(() => {
    const feels = answers.feel;
    const occasion = answers.occasion;
    const avoids = answers.avoid;
    const bold = feels.some((x) =>
      ["Bold", "Editorial", "High-fashion", "Sultry", "Smoky"].includes(x),
    );
    const glow =
      feels.some((x) =>
        ["Luminous", "Fresh-faced", "Romantic", "Soft glam"].includes(x),
      ) && !avoids.includes("High shine");
    const night = occasion.some((x) =>
      ["Party", "Concert", "Festival", "Date night", "Formal event"].includes(
        x,
      ),
    );
    if (bold || night) {
      const blushPalette = glow
        ? blushPalettes.gilded
        : blushPalettes.blackCherry;
      return {
        name: glow ? "鎏金夜色" : "黑樱桃丝绒",
        note: "柔和雕琢的轮廓、融金般的光泽与自信烟熏眼妆——保留你的本色，而非戴上一副面具。",
        tags: [
          "自然烟熏",
          glow ? "融金光泽" : "丝绒肌",
          "玫瑰木唇色",
        ],
        accent: "#d5aa55",
        blushPalette,
      };
    }
    const blushPalette = glow
      ? blushPalettes.bareGold
      : blushPalettes.softFocus;
    return {
      name: glow ? "裸金流光" : "柔焦缪斯",
      note: "以轻盈透气的肌肤为主角，搭配柔和轮廓、温暖金调与自然放大的唇色。",
      tags: [
        "自在轻透肌",
        glow ? "由内而亮" : "柔雾哑光",
        "玫瑰裸色",
      ],
      accent: "#e3bc78",
      blushPalette,
    };
  }, [answers]);

  useEffect(() => {
    blushPaletteRef.current = look.blushPalette;
  }, [look.blushPalette]);

  const toggle = (key: string, option: string) =>
    setAnswers((prev) => ({
      ...prev,
      [key]:
        key === "skin"
          ? prev[key].includes(option)
            ? []
            : [option]
          : prev[key].includes(option)
            ? prev[key].filter((x) => x !== option)
            : [...prev[key], option],
    }));

  const begin = () => {
    setAnswers(emptyAnswers);
    setStep(0);
    setEditingFromConfirm(false);
    setScreen("quiz");
    window.scrollTo(0, 0);
  };
  const next = () => {
    if (editingFromConfirm) {
      setEditingFromConfirm(false);
      setScreen("confirm");
    } else if (step < questions.length - 1) setStep(step + 1);
    else setScreen("confirm");
    window.scrollTo(0, 0);
  };
  const back = () => {
    if (editingFromConfirm) {
      setEditingFromConfirm(false);
      setScreen("confirm");
    } else if (step > 0) setStep(step - 1);
    else setScreen("home");
    window.scrollTo(0, 0);
  };
  const saveLook = () => {
    const item = {
      id: Date.now(),
      name: look.name,
      note: look.note,
      answers,
      eyeIntensity,
      blushIntensity,
      glowIntensity,
    };
    const nextSaved = [item, ...saved].slice(0, 12);
    setSaved(nextSaved);
    localStorage.setItem("fenty-saved-looks", JSON.stringify(nextSaved));
    setNotice("妆容已收藏");
    setTimeout(() => setNotice(""), 2200);
  };

  const openSavedLook = (item: SavedLook) => {
    setAnswers(item.answers);
    setEyeIntensity(
      item.eyeIntensity ?? item.intensity ?? recommendedIntensities.eye,
    );
    setBlushIntensity(item.blushIntensity ?? recommendedIntensities.blush);
    setGlowIntensity(item.glowIntensity ?? recommendedIntensities.glow);
    setLookReturnScreen("saved");
    setScreen("look");
    window.scrollTo(0, 0);
  };

  return (
    <main className="site-shell">
      <header className="nav">
        <button
          className="wordmark"
          onClick={() => {
            setEditingFromConfirm(false);
            setScreen("home");
          }}
        >
          万象
        </button>
        <div className="nav-meta">
          <span className="edition">AI 妆容探索 / 01</span>
          <button
            className="saved-button"
            onClick={() => {
              if (screen !== "saved") setSavedReturnScreen(screen);
              setScreen("saved");
              window.scrollTo(0, 0);
            }}
          >
            我的收藏 <i>{saved.length}</i>
          </button>
        </div>
      </header>

      {screen === "home" && (
        <section className="hero page-enter">
          <div className="hero-copy">
            <p className="kicker">万象 · AI 妆容探索</p>
            <h1>
              美，
              <br />
              从不被<em>定义。</em>
              <br />
              只被看见。
            </h1>
            <p className="dek">
              告诉我们你的场合、肤质与想呈现的感觉。万象会把你的回答，
              转化成专属于你的妆容态度。
            </p>
            <button className="gold-cta" onClick={begin}>
              <span>开始探索</span>
              <b>↗</b>
            </button>
            <p className="micro">4 个问题 · 约 90 秒</p>
          </div>
          <div
            className="portrait hero-portrait"
            aria-label="杂志感妆容人像"
          >
            <img
              src="/images/asian-hero.png"
              alt="蓝紫光影下的亚洲女性美妆人像"
            />
            <div className="makeup-wash" />
            <div className="orbit orbit-one">你的面容</div>
            <div className="orbit orbit-two">你的规则</div>
            <span className="portrait-no">001</span>
          </div>
        </section>
      )}

      {screen === "quiz" &&
        (() => {
          const q = questions[step];
          return (
            <section className="quiz page-enter">
              <div className="progress">
                <span style={{ width: `${((step + 1) / 4) * 100}%` }} />
              </div>
              <div className="quiz-head">
                <p className="kicker">{q.eyebrow}</p>
                <span>{String(step + 1).padStart(2, "0")} / 04</span>
              </div>
              <h2>{q.title}</h2>
              <p className="quiz-hint">{q.hint}</p>
              <div
                className={`option-grid ${q.options.length === 6 ? "six" : ""}`}
              >
                {q.options.map((option, i) => (
                  <button
                    key={option}
                    aria-pressed={answers[q.key].includes(option)}
                    className={
                      answers[q.key].includes(option) ? "selected" : ""
                    }
                    onClick={() => toggle(q.key, option)}
                  >
                    <small>{String(i + 1).padStart(2, "0")}</small>
                    <span>{optionLabels[option] ?? option}</span>
                    <b>{answers[q.key].includes(option) ? "✓" : "+"}</b>
                  </button>
                ))}
              </div>
              <div className="quiz-actions">
                <button className="text-button" onClick={back}>
                  ← 返回
                </button>
                <button
                  className="gold-cta compact"
                  disabled={!answers[q.key].length}
                  onClick={next}
                >
                  <span>
                    {editingFromConfirm
                      ? "完成修改，返回确认"
                      : step === 3
                        ? "查看答案"
                        : "继续"}
                  </span>
                  <b>→</b>
                </button>
              </div>
            </section>
          );
        })()}

      {screen === "confirm" && (
        <section className="confirm page-enter">
          <p className="kicker">你的选择 / 04 / 04</p>
          <h2>
            <span>最后确认一次。</span>
            <em>这依然是你想要的感觉吗？</em>
          </h2>
          <div className="answer-review">
            {questions.map((q, i) => (
              <article key={q.key}>
                <div>
                  <small>0{i + 1}</small>
                  <h3>{q.title}</h3>
                </div>
                <p>
                  {answers[q.key]
                    .map((answer) => optionLabels[answer] ?? answer)
                    .join(" · ")}
                </p>
                <button
                  onClick={() => {
                    setStep(i);
                    setEditingFromConfirm(true);
                    setScreen("quiz");
                    window.scrollTo(0, 0);
                  }}
                >
                  修改
                </button>
              </article>
            ))}
          </div>
          <div className="confirm-actions">
            <button
              className="text-button"
              onClick={() => {
                setStep(3);
                setEditingFromConfirm(false);
                setScreen("quiz");
                window.scrollTo(0, 0);
              }}
            >
              ← 返回
            </button>
            <button
              className="gold-cta"
              onClick={() => {
                setLookReturnScreen("confirm");
                setScreen("look");
                window.scrollTo(0, 0);
              }}
            >
              <span>揭晓我的妆容</span>
              <b>✦</b>
            </button>
          </div>
        </section>
      )}

      {screen === "look" && (
        <section className="result page-enter">
          <div className="result-left">
            <div
              className={`result-visual portrait ${cameraMode === "live" ? "camera-live" : ""}`}
              style={
                {
                  "--eye-intensity": eyeIntensity / 100,
                  "--blush-intensity": blushIntensity / 100,
                  "--glow-intensity": glowIntensity / 100,
                  "--blush-core": look.blushPalette.sampleCore,
                  "--blush-mid": look.blushPalette.sampleMid,
                  "--blush-edge": look.blushPalette.sampleEdge,
                } as React.CSSProperties
              }
            >
            <video ref={videoRef} muted playsInline aria-hidden="true" />
            <canvas
              ref={canvasRef}
              className="camera-canvas"
              aria-label="实时摄像头妆容预览"
            />
            {cameraMode !== "live" && (
              <div className="sample-stage">
                <img
                  src="/images/asian-hero.png"
                  alt="展示推荐妆容的亚洲女性模特"
                />
                <div className="eye-shadow" aria-hidden="true" />
                <div className="blush-wash" aria-hidden="true" />
                <div className="glow-wash" aria-hidden="true" />
              </div>
            )}
            {(cameraMode === "sample" || cameraMode === "error") && (
              <div className="camera-entry">
                <button onClick={() => setCameraMode("consent")}>
                  <span>◉</span> 实时试妆
                </button>
                {cameraMode === "error" && <p>{cameraError}</p>}
              </div>
            )}
            {cameraMode === "consent" && (
              <div className="camera-consent" role="dialog" aria-modal="true">
                <small>实时试妆</small>
                <h3>在你的脸上预览妆容。</h3>
                <p>
                  摄像头画面仅在此设备上处理，不会被录制、上传或保存。
                </p>
                <div>
                  <button className="camera-allow" onClick={startCamera}>
                    允许使用摄像头
                  </button>
                  <button onClick={() => setCameraMode("sample")}>暂时不要</button>
                </div>
              </div>
            )}
            {cameraMode === "starting" && (
              <div className="camera-loading" role="status">
                <span />
                正在准备实时试妆…
              </div>
            )}
            {cameraMode === "live" && (
              <>
                <div className="camera-live-controls">
                  <span className={faceVisible ? "face-found" : ""}>
                    {faceVisible ? "已识别面部" : "请将面部移入画面"}
                  </span>
                  <button onClick={() => void stopCamera()}>关闭摄像头</button>
                </div>
                <p className="camera-lighting-tip">
                  请在光线充足且均匀的环境中测试，过暗或背光可能影响妆效准确度。
                </p>
              </>
            )}
              <span className="look-stamp">
                为你的
                <br />
                真我而生
              </span>
            </div>
            <button
              className="text-button visual-back-button"
              onClick={() => {
                setScreen(lookReturnScreen);
                window.scrollTo(0, 0);
              }}
            >
              ← 返回
            </button>
          </div>
          <div className="result-copy">
            <p className="kicker">你的万象妆容</p>
            <h2>{look.name}</h2>
            <p className="look-note">{look.note}</p>
            <div className="look-tags">
              {look.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className="intensity-controls">
              <div className="intensity-reset-row">
                <span>推荐强度</span>
                <button type="button" onClick={resetIntensities}>
                  <span aria-hidden="true">↺</span> 重置
                </button>
              </div>
              <p className="intensity-demo-note">
                演示说明：为方便清楚观察强度变化，画面会强化颜色差异，并不代表产品的真实颜色深度。
              </p>
              <div className="intensity">
                <div>
                  <label htmlFor="eye-intensity">眼影强度</label>
                  <output>{eyeIntensity}%</output>
                </div>
                <input
                  id="eye-intensity"
                  type="range"
                  min="0"
                  max="100"
                  value={eyeIntensity}
                  onChange={(e) => setEyeIntensity(+e.target.value)}
                />
                <div className="range-labels">
                  <span>轻柔晕染</span>
                  <span>深邃烟熏</span>
                </div>
              </div>
              <div className="intensity">
                <div>
                  <label htmlFor="blush-intensity">腮红强度</label>
                  <output>{blushIntensity}%</output>
                </div>
                <input
                  id="blush-intensity"
                  type="range"
                  min="0"
                  max="100"
                  value={blushIntensity}
                  onChange={(e) => setBlushIntensity(+e.target.value)}
                />
                <div className="range-labels">
                  <span>自然红润</span>
                  <span>深莓红</span>
                </div>
              </div>
              <div className="intensity">
                <div>
                  <label htmlFor="glow-intensity">高光强度</label>
                  <output>{glowIntensity}%</output>
                </div>
                <input
                  id="glow-intensity"
                  type="range"
                  min="0"
                  max="100"
                  value={glowIntensity}
                  onChange={(e) => setGlowIntensity(+e.target.value)}
                />
                <div className="range-labels">
                  <span>柔和微光</span>
                  <span>通透光泽</span>
                </div>
              </div>
            </div>
            <button
              className="gold-cta"
              onClick={() => {
                setScreen("products");
                window.scrollTo(0, 0);
              }}
            >
              <span>查看推荐产品</span>
              <b>↓</b>
            </button>
          </div>
        </section>
      )}

      {screen === "products" && (
        <section className="products page-enter">
          <button
            className="text-button section-back"
            onClick={() => {
              setScreen("look");
              window.scrollTo(0, 0);
            }}
          >
            ← 返回上一页
          </button>
          <div className="products-head">
            <div>
              <p className="kicker">妆容配方</p>
              <h2>打造你的妆容。</h2>
            </div>
            <p>
              为<em>{look.name}</em>精选的四款 Fenty 必备单品。
              价格为美元示范数据。
            </p>
          </div>
          <p className="product-demo-note">
            比赛演示说明：本页展示的产品名称、图片、色号与价格均为示例内容，仅用于呈现概念体验，不代表真实产品、实际售价或购买建议。
          </p>
          <div className="product-grid">
            {products.map((p, i) => (
              <article className="product-card" key={p.name}>
                <ProductArt product={p} index={i} />
                <div className="product-body">
                  <p className="product-form">
                    {p.form} · {p.skin}
                  </p>
                  <h3>{p.name}</h3>
                  <p className="shade">色号系列 — {p.shade}</p>
                  <div className="price">
                    {p.old && <del>{p.old}</del>}
                    <strong className={p.old ? "sale" : ""}>{p.price}</strong>
                  </div>
                  <dl>
                    <dt>使用方法</dt>
                    <dd>{p.use}</dd>
                    <dt>推荐理由</dt>
                    <dd>{p.why}</dd>
                  </dl>
                </div>
              </article>
            ))}
          </div>
          <div className="save-panel">
            <div>
              <small>喜欢这套妆容吗？</small>
              <h3>把它收藏起来。</h3>
              <p>你的妆容推荐仅保存在此设备上。</p>
            </div>
            <button className="gold-cta" onClick={saveLook}>
              <span>收藏推荐</span>
              <b>♡</b>
            </button>
          </div>
        </section>
      )}

      {screen === "saved" && (
        <section className="saved-page page-enter">
          <button
            className="text-button section-back"
            onClick={() => {
              setScreen(savedReturnScreen === "saved" ? "home" : savedReturnScreen);
              window.scrollTo(0, 0);
            }}
          >
            ← 返回上一页
          </button>
          <p className="kicker">你的妆容档案</p>
          <h2>已收藏的推荐。</h2>
          {saved.length === 0 ? (
            <div className="empty-state">
              <span>♡</span>
              <h3>还没有收藏妆容。</h3>
              <p>你之后收藏的心仪妆容会出现在这里。</p>
              <button className="gold-cta" onClick={begin}>
                <span>创建妆容</span>
                <b>↗</b>
              </button>
            </div>
          ) : (
            <div className="saved-grid">
              {saved.map((item, i) => (
                <article
                  key={item.id}
                  className="saved-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`打开妆容：${savedLookNames[item.name] ?? item.name}`}
                  onClick={() => openSavedLook(item)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openSavedLook(item);
                    }
                  }}
                >
                  <div className="saved-thumb">
                    <img
                      src="/images/asian-hero.png"
                      alt="已收藏的亚洲女性妆容示范"
                    />
                    <span>0{i + 1}</span>
                  </div>
                  <small>已收藏的万象妆容</small>
                  <h3>{savedLookNames[item.name] ?? item.name}</h3>
                  <p>{savedLookNotes[item.note] ?? item.note}</p>
                  <div>
                    <span className="saved-open">打开妆容</span>
                    <button
                      aria-label="删除已收藏的妆容"
                      onClick={(event) => {
                        event.stopPropagation();
                        const n = saved.filter((x) => x.id !== item.id);
                        setSaved(n);
                        localStorage.setItem(
                          "fenty-saved-looks",
                          JSON.stringify(n),
                        );
                      }}
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {notice && (
        <div className="toast">
          {notice} <span>✓</span>
        </div>
      )}
      <footer>
        <span>万象</span>
        <span>不止一种美，不止一个你</span>
        <span>概念体验 · 2026</span>
      </footer>
    </main>
  );
}
