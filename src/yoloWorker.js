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
    if (!session) {
      console.warn('Worker: Inference requested but session not loaded.');
      return;
    }

    try {
      const { tensor, originalWidth, originalHeight } = payload;
      const feeds = { [session.inputNames[0]]: tensor };

      console.log('Worker: Starting inference run...');
      const results = await session.run(feeds);
      const output = results[session.outputNames[0]];
      console.log('Worker: Inference complete. Output shape:', output.dims);

      const detections = processYOLOv8Output(output, originalWidth, originalHeight);
      console.log('Worker: Detections found:', detections.length);

      self.postMessage({ type: 'INFERENCE_RESULT', payload: detections });
    } catch (e) {
      console.error('Worker Inference Error:', e);
      self.postMessage({ type: 'ERROR', payload: e.message });
    }
  }
};

function processYOLOv8Output(output, width, height) {
  const data = output.data;
  const dims = output.dims; // [1, 84, 8400] or [1, 8400, 84]

  let numDetections, numFeatures, isTransposed;

  if (dims[1] > dims[2]) {
    // [1, 8400, 84]
    numDetections = dims[1];
    numFeatures = dims[2];
    isTransposed = true;
  } else {
    // [1, 84, 8400]
    numDetections = dims[2];
    numFeatures = dims[1];
    isTransposed = false;
  }

  const numClasses = numFeatures - 4;
  const detections = [];
  const confidenceThreshold = 0.3; // Lowered for debugging

  for (let i = 0; i < numDetections; i++) {
    let maxScore = 0;
    let maxClass = -1;

    for (let c = 0; c < numClasses; c++) {
      const score = isTransposed
        ? data[i * numFeatures + (c + 4)]
        : data[numDetections * (c + 4) + i];

      if (score > maxScore) {
        maxScore = score;
        maxClass = c;
      }
    }

    if (maxScore > confidenceThreshold) {
      const x = isTransposed ? data[i * numFeatures + 0] : data[numDetections * 0 + i];
      const y = isTransposed ? data[i * numFeatures + 1] : data[numDetections * 1 + i];
      const w = isTransposed ? data[i * numFeatures + 2] : data[numDetections * 2 + i];
      const h = isTransposed ? data[i * numFeatures + 3] : data[numDetections * 3 + i];

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
