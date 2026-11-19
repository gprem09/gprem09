import {
  FilesetResolver,
  HandLandmarker
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/vision_bundle.mjs";

const video = document.querySelector("#webcam");
const trackingCanvas = document.querySelector("#trackingCanvas");
const trackingCtx = trackingCanvas.getContext("2d");
const fxCanvas = document.querySelector("#fxCanvas");
const fxCtx = fxCanvas.getContext("2d");

const cameraFrame = document.querySelector("#cameraFrame");
const stageEmpty = document.querySelector("#stageEmpty");
const loadingState = document.querySelector("#loadingState");
const loadingText = document.querySelector("#loadingText");
const errorState = document.querySelector("#errorState");
const errorText = document.querySelector("#errorText");
const startCameraButton = document.querySelector("#startCamera");
const retryCameraButton = document.querySelector("#retryCamera");
const stopCameraButton = document.querySelector("#stopCamera");
const privacyIndicator = document.querySelector("#privacyIndicator");
const privacyText = document.querySelector("#privacyText");
const gestureName = document.querySelector("#gestureName");
const confidenceValue = document.querySelector("#confidenceValue");
const confidenceBar = document.querySelector("#confidenceBar");
const fpsLabel = document.querySelector("#fpsLabel");
const signalBars = [...document.querySelectorAll("#signalBars i")];
const gestureCards = [...document.querySelectorAll(".gesture-card")];

let handLandmarker = null;
let stream = null;
let animationId = null;
let lastVideoTime = -1;
let running = false;
let currentGesture = "standby";
let landmarks = null;
let confidence = 0;
let frameCount = 0;
let fpsTime = performance.now();
let burstCooldown = 0;
let pinchPulse = 0;
let projectile = null;
let particles = [];
let lastInferenceTime = -Infinity;
let confidenceBucket = -1;

const gestureLabels = {
  standby: "STANDBY",
  palm: "OPEN PALM",
  fist: "CLOSED FIST",
  pinch: "PINCH",
  point: "POINT"
};

function resizeCanvases() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = fxCanvas.getBoundingClientRect();
  fxCanvas.width = Math.floor(rect.width * dpr);
  fxCanvas.height = Math.floor(rect.height * dpr);
  fxCanvas.style.width = `${rect.width}px`;
  fxCanvas.style.height = `${rect.height}px`;
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const trackRect = trackingCanvas.getBoundingClientRect();
  trackingCanvas.width = Math.floor(trackRect.width * dpr);
  trackingCanvas.height = Math.floor(trackRect.height * dpr);
  trackingCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener("resize", resizeCanvases);
resizeCanvases();

async function createHandLandmarker(delegate = "GPU") {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm"
  );
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate
    },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });
}

function setLoading(text) {
  stageEmpty.hidden = true;
  errorState.hidden = true;
  loadingState.hidden = false;
  loadingText.textContent = text;
}

function showError(message) {
  loadingState.hidden = true;
  stageEmpty.hidden = true;
  errorState.hidden = false;
  errorText.textContent = message;
}

function updatePrivacy(live) {
  privacyIndicator.classList.toggle("live", live);
  privacyText.textContent = live ? "CAMERA ACTIVE · LOCAL ONLY" : "CAMERA OFFLINE";
  stopCameraButton.hidden = !live;
}

async function startCamera() {
  if (running) return;
  setLoading("Requesting camera permission");

  if (!navigator.mediaDevices?.getUserMedia) {
    showError("Camera API unavailable. Open this page over localhost or HTTPS.");
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 30, max: 30 }
      }
    });
    video.srcObject = stream;
    await video.play();

    setLoading("Loading MediaPipe hand model");
    if (!handLandmarker) {
      try {
        handLandmarker = await createHandLandmarker("GPU");
      } catch (gpuError) {
        console.warn("GPU hand model unavailable; retrying with CPU.", gpuError);
        handLandmarker = await createHandLandmarker("CPU");
      }
    }

    running = true;
    cameraFrame.classList.add("live");
    stageEmpty.hidden = true;
    loadingState.hidden = true;
    errorState.hidden = true;
    updatePrivacy(true);
    resizeCanvases();
    animate();
  } catch (error) {
    console.error(error);
    let message = "Camera or hand model could not start.";
    if (error?.name === "NotAllowedError") message = "Camera permission was denied.";
    if (error?.name === "NotFoundError") message = "No camera was found on this device.";
    if (/fetch|network|certificate/i.test(error?.message || "")) {
      message = "MediaPipe model failed to load. Check your connection.";
    }
    showError(message);
    stopStream();
  }
}

function stopStream() {
  running = false;
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  cameraFrame.classList.remove("live");
  const trackRect = trackingCanvas.getBoundingClientRect();
  trackingCtx.clearRect(0, 0, trackRect.width, trackRect.height);
  fxCtx.clearRect(0, 0, fxCanvas.clientWidth, fxCanvas.clientHeight);
  updatePrivacy(false);
  stageEmpty.hidden = false;
  loadingState.hidden = true;
  errorState.hidden = true;
  setGesture("standby", 0);
  landmarks = null;
  particles = [];
  projectile = null;
}

startCameraButton.addEventListener("click", startCamera);
retryCameraButton.addEventListener("click", startCamera);
stopCameraButton.addEventListener("click", stopStream);

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function detectGesture(points) {
  const wrist = points[0];
  const thumbTip = points[4];
  const indexTip = points[8];
  const middleTip = points[12];
  const ringTip = points[16];
  const pinkyTip = points[20];
  const indexMcp = points[5];
  const middleMcp = points[9];
  const ringMcp = points[13];
  const pinkyMcp = points[17];

  const fingers = [indexTip, middleTip, ringTip, pinkyTip];
  const mcps = [indexMcp, middleMcp, ringMcp, pinkyMcp];
  const extended = fingers.reduce((count, tip, i) => count + (distance(tip, wrist) > distance(mcps[i], wrist) * 1.32 ? 1 : 0), 0);
  const pinchDist = distance(thumbTip, indexTip);

  if (pinchDist < 0.075) return "pinch";
  if (extended >= 3) return "palm";
  if (extended <= 1) return "fist";

  const indexExtended = distance(indexTip, wrist) > distance(indexMcp, wrist) * 1.25;
  const otherFolded = [middleTip, ringTip, pinkyTip].every((tip, i) =>
    distance(tip, wrist) < distance([middleMcp, ringMcp, pinkyMcp][i], wrist) * 1.22
  );
  if (indexExtended && otherFolded) return "point";
  return "palm";
}

function setGesture(type, confidenceValueRaw) {
  const nextConfidenceBucket = type === "standby"
    ? 0
    : Math.round(confidenceValueRaw * 10);
  const gestureChanged = type !== currentGesture;

  currentGesture = type;
  confidence = confidenceValueRaw;
  if (gestureChanged) {
    gestureName.textContent = gestureLabels[type];
    gestureCards.forEach(card => {
      card.classList.toggle("active", card.dataset.gesture === type);
    });
  }

  if (nextConfidenceBucket !== confidenceBucket) {
    confidenceBucket = nextConfidenceBucket;
    confidenceValue.textContent = `${Math.round(confidence * 100)}%`;
    confidenceBar.style.width = `${Math.round(confidence * 100)}%`;
    const activeCount = type === "standby" ? 1 : 5 + Math.round(confidence * 3);
    signalBars.forEach((bar, i) => bar.classList.toggle("active", i < Math.min(activeCount, 8)));
  }
}

function mapPoint(point) {
  const frame = trackingCanvas.getBoundingClientRect();
  const appRect = fxCanvas.getBoundingClientRect();
  return {
    x: (1 - point.x) * frame.width + (frame.left - appRect.left),
    y: point.y * frame.height + (frame.top - appRect.top),
  };
}

function drawLandmarks(points) {
  const rect = trackingCanvas.getBoundingClientRect();
  trackingCtx.clearRect(0, 0, rect.width, rect.height);
  trackingCtx.strokeStyle = "rgba(128, 232, 255, .46)";
  trackingCtx.fillStyle = "rgba(177, 245, 255, .78)";
  trackingCtx.lineWidth = 1;

  const connections = [
    [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],[0,17]
  ];

  for (const [a, b] of connections) {
    const pa = points[a];
    const pb = points[b];
    trackingCtx.beginPath();
    trackingCtx.moveTo((1 - pa.x) * rect.width, pa.y * rect.height);
    trackingCtx.lineTo((1 - pb.x) * rect.width, pb.y * rect.height);
    trackingCtx.stroke();
  }
  for (const point of points) {
    trackingCtx.beginPath();
    trackingCtx.arc((1 - point.x) * rect.width, point.y * rect.height, 1.8, 0, Math.PI * 2);
    trackingCtx.fill();
  }
}

function animate() {
  if (!running) return;
  const now = performance.now();
  let detected = false;

  if (!document.hidden &&
      video.readyState >= 2 &&
      handLandmarker &&
      now - lastInferenceTime >= 33) {
    lastInferenceTime = now;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = handLandmarker.detectForVideo(video, now);
      if (result.landmarks?.length) {
        detected = true;
        landmarks = result.landmarks[0];
        drawLandmarks(landmarks);

        const gesture = detectGesture(landmarks);
        const rawConfidence = result.handednesses?.[0]?.[0]?.score || 0.78;
        setGesture(gesture, rawConfidence);
        updateEffects(landmarks, gesture);
      } else {
        trackingCtx.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
        landmarks = null;
        setGesture("standby", 0);
      }
    }
  }

  drawEffects(now);
  frameCount++;
  if (now - fpsTime > 1000) {
    fpsLabel.textContent = `${Math.round(frameCount * 1000 / (now - fpsTime))} FPS`;
    frameCount = 0;
    fpsTime = now;
  }

  if (!detected && !landmarks) particles = particles.filter(p => p.life > 0);
  animationId = requestAnimationFrame(animate);
}

function updateEffects(points, gesture) {
  const palm = mapPoint(points[9]);
  const pinch = mapPoint(points[4]);
  const fingertip = mapPoint(points[8]);

  if (gesture !== "point") projectile = null;
  if (gesture === "fist" && burstCooldown <= performance.now()) {
    burstCooldown = performance.now() + 500;
    spawnBurst(palm);
  }
  if (gesture === "pinch") {
    pinchPulse++;
    if (pinchPulse % 2 === 0) spawnSparks(pinch, fingertip);
  }
  if (gesture === "point") {
    const dx = fingertip.x - pinch.x;
    const dy = fingertip.y - pinch.y;
    const length = Math.hypot(dx, dy) || 1;
    projectile = {
      x: fingertip.x,
      y: fingertip.y,
      dx: dx / length,
      dy: dy / length,
      life: 1,
      time: performance.now()
    };
  }
}

function spawnBurst(center) {
  if (particles.length > 180) particles.splice(0, particles.length - 180);
  for (let i = 0; i < 42; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 7;
    particles.push({
      type: "fire",
      x: center.x,
      y: center.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 3 + Math.random() * 11,
      life: 1,
      decay: 0.025 + Math.random() * 0.025
    });
  }
}

function spawnSparks(a, b) {
  for (let i = 0; i < 3; i++) {
    particles.push({
      type: "spark",
      x: a.x + (Math.random() - .5) * 12,
      y: a.y + (Math.random() - .5) * 12,
      vx: (b.x - a.x) * .04 + (Math.random() - .5) * 4,
      vy: (b.y - a.y) * .04 + (Math.random() - .5) * 4,
      size: 1 + Math.random() * 2,
      life: 1,
      decay: 0.06 + Math.random() * 0.05
    });
  }
}

function drawEffects(now) {
  const w = fxCanvas.clientWidth;
  const h = fxCanvas.clientHeight;
  fxCtx.clearRect(0, 0, w, h);
  fxCtx.globalCompositeOperation = "lighter";

  if (landmarks) {
    const palm = mapPoint(landmarks[9]);
    if (currentGesture === "palm") drawShield(palm, now);
    if (currentGesture === "point") drawProjectileAim(palm, now);
  }

  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.98;
    p.vy *= 0.98;
    p.life -= p.decay;

    fxCtx.globalAlpha = Math.max(0, p.life);
    if (p.type === "fire") {
      fxCtx.fillStyle = p.life > 0.55 ? "#ffd17a" : "#ff5d36";
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      fxCtx.fill();
    } else {
      fxCtx.strokeStyle = "#82efff";
      fxCtx.lineWidth = p.size;
      fxCtx.beginPath();
      fxCtx.moveTo(p.x, p.y);
      fxCtx.lineTo(p.x - p.vx * 5, p.y - p.vy * 5);
      fxCtx.stroke();
    }
  }

  if (projectile) {
    projectile.life -= 0.018;
    projectile.x += projectile.dx * 8;
    projectile.y += projectile.dy * 8;
    fxCtx.globalAlpha = Math.max(0, projectile.life);
    fxCtx.fillStyle = "#b5f3ff";
    fxCtx.shadowColor = "#65cfff";
    fxCtx.shadowBlur = 22;
    fxCtx.beginPath();
    fxCtx.arc(projectile.x, projectile.y, 8, 0, Math.PI * 2);
    fxCtx.fill();
    fxCtx.strokeStyle = "rgba(122, 220, 255, .7)";
    fxCtx.lineWidth = 2;
    fxCtx.beginPath();
    fxCtx.moveTo(projectile.x - projectile.dx * 28, projectile.y - projectile.dy * 28);
    fxCtx.lineTo(projectile.x, projectile.y);
    fxCtx.stroke();
    fxCtx.shadowBlur = 0;
  }

  fxCtx.globalAlpha = 1;
  fxCtx.globalCompositeOperation = "source-over";
}

function drawShield(center, now) {
  const pulse = 1 + Math.sin(now * .004) * .025;
  fxCtx.save();
  fxCtx.translate(center.x, center.y);
  fxCtx.scale(pulse, pulse);
  fxCtx.strokeStyle = "rgba(114, 225, 255, .58)";
  fxCtx.lineWidth = 2;
  fxCtx.shadowColor = "#71dfff";
  fxCtx.shadowBlur = 18;

  fxCtx.beginPath();
  fxCtx.arc(0, 0, 72, 0, Math.PI * 2);
  fxCtx.stroke();

  fxCtx.strokeStyle = "rgba(149, 239, 255, .22)";
  fxCtx.lineWidth = 9;
  fxCtx.setLineDash([10, 16]);
  fxCtx.lineDashOffset = -now * .02;
  fxCtx.beginPath();
  fxCtx.arc(0, 0, 94, 0, Math.PI * 2);
  fxCtx.stroke();

  fxCtx.setLineDash([]);
  fxCtx.fillStyle = "rgba(92, 213, 255, .025)";
  fxCtx.beginPath();
  fxCtx.arc(0, 0, 68, 0, Math.PI * 2);
  fxCtx.fill();
  fxCtx.restore();
}

function drawProjectileAim(palm, now) {
  if (!landmarks) return;
  const tip = mapPoint(landmarks[8]);
  fxCtx.save();
  fxCtx.strokeStyle = "rgba(137, 224, 255, .52)";
  fxCtx.fillStyle = "#baf4ff";
  fxCtx.shadowColor = "#72ddff";
  fxCtx.shadowBlur = 15;
  fxCtx.setLineDash([3, 7]);
  fxCtx.lineDashOffset = -now * .03;
  fxCtx.beginPath();
  fxCtx.moveTo(tip.x, tip.y);
  fxCtx.lineTo(tip.x + (tip.x - palm.x) * 3.5, tip.y + (tip.y - palm.y) * 3.5);
  fxCtx.stroke();
  fxCtx.setLineDash([]);
  fxCtx.beginPath();
  fxCtx.arc(tip.x, tip.y, 5 + Math.sin(now * .012) * 2, 0, Math.PI * 2);
  fxCtx.fill();
  fxCtx.restore();
}
