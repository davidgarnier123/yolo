import * as ort from 'onnxruntime-web';

let session;
// Use CDN for more reliable module loading in Vite/Vercel environments
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === 'LOAD_MODEL') {
    try {
      session = await ort.InferenceSession.create(payload.modelUrl, {
        executionProviders: ['wasm', 'webgl'],
        graphOptimizationLevel: 'all'
      });
      self.postMessage({ type: 'MODEL_LOADED' });
    } catch (e) {
      self.postMessage({ type: 'ERROR', payload: `Model Load Failed: ${e.message}` });
    }
  }

  if (type === 'INFER') {
    if (!session) return;

    try {
      const { tensor, originalWidth, originalHeight } = payload;
      const feeds = { [session.inputNames[0]]: tensor };
      const results = await session.run(feeds);
      const output = results[session.outputNames[0]];

      // Post-processing: YOLOv8 output is usually [1, classes + 4, 8400]
      // We need to parse boxes and scores, apply confidence threshold and NMS
      const detections = processYOLOv8Output(output.data, originalWidth, originalHeight);

      self.postMessage({ type: 'INFERENCE_RESULT', payload: detections });
    } catch (e) {
      self.postMessage({ type: 'ERROR', payload: e.message });
    }
  }
};

function processYOLOv8Output(data, width, height) {
  // Simplified YOLOv8 parsing (v8-specific format)
  // [x, y, w, h, score1, score2, ...]
  const numDetections = 8400; // standard for 640x640 input
  const numClasses = data.length / numDetections - 4;
  const detections = [];
  const confidenceThreshold = 0.5;

  for (let i = 0; i < numDetections; i++) {
    let maxScore = 0;
    let maxClass = -1;

    for (let c = 0; c < numClasses; c++) {
      const score = data[i + numDetections * (c + 4)];
      if (score > maxScore) {
        maxScore = score;
        maxClass = c;
      }
    }

    if (maxScore > confidenceThreshold) {
      const x = data[i + numDetections * 0];
      const y = data[i + numDetections * 1];
      const w = data[i + numDetections * 2];
      const h = data[i + numDetections * 3];

      // Convert to normalization coords (assuming 640x640 input)
      // and then to original image coords
      detections.push({
        box: [
          (x - w / 2) * (width / 640),
          (y - h / 2) * (height / 640),
          w * (width / 640),
          h * (height / 640)
        ],
        confidence: maxScore,
        className: maxClass === 0 ? 'barcode' : 'other'
      });
    }
  }

  return nms(detections, 0.45);
}

function nms(boxes, threshold) {
  // Basic NMS implementation
  boxes.sort((a, b) => b.confidence - a.confidence);
  const picked = [];
  const suppressed = new Set();

  for (let i = 0; i < boxes.length; i++) {
    if (suppressed.has(i)) continue;
    picked.push(boxes[i]);
    for (let j = i + 1; j < boxes.length; j++) {
      if (suppressed.has(j)) continue;
      if (iou(boxes[i].box, boxes[j].box) > threshold) {
        suppressed.add(j);
      }
    }
  }
  return picked;
}

function iou(boxA, boxB) {
  const xA = Math.max(boxA[0], boxB[0]);
  const yA = Math.max(boxA[1], boxB[1]);
  const xB = Math.min(boxA[0] + boxA[2], boxB[0] + boxB[2]);
  const yB = Math.min(boxA[1] + boxA[3], boxB[1] + boxB[3]);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const boxAArea = boxA[2] * boxA[3];
  const boxBArea = boxB[2] * boxB[3];

  return interArea / (boxAArea + boxBArea - interArea);
}
