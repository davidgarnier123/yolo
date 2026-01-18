import * as ort from 'onnxruntime-web';

// Configuration
const YOLO_INPUT_SIZE = 640;
let session = null;

// Helper for logging back to main thread
function log(msg, type = 'info') {
    self.postMessage({ type: 'LOG', payload: { msg, type } });
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'LOAD_MODEL') {
        try {
            log('Chargement du moteur ONNX...');
            // Use the EXACT same version as in package.json
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
            ort.env.wasm.numThreads = 1; // Stabilize in workers

            session = await ort.InferenceSession.create(payload.modelUrl, {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });

            log('Moteur prêt (WASM)', 'success');
            self.postMessage({ type: 'MODEL_LOADED' });
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: err.message });
        }
    }

    if (type === 'FRAME') {
        if (!session) return;
        try {
            const { floatData, originalWidth, originalHeight, threshold = 0.25 } = payload;

            // Reconstruct tensor here to avoid serialization issues
            const tensor = new ort.Tensor('float32', floatData, [1, 3, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE]);
            const feeds = { [session.inputNames[0]]: tensor };
            const results = await session.run(feeds);

            const detections = processYOLOv8Output(results, originalWidth, originalHeight, threshold);

            self.postMessage({
                type: 'INFERENCE_RESULT',
                payload: {
                    detections,
                    width: originalWidth,
                    height: originalHeight
                }
            });
        } catch (err) {
            log(`Inference Error: ${err.message}`, 'error');
        }
    }
};

function processYOLOv8Output(outputsObj, width, height, threshold) {
    const output = outputsObj[Object.keys(outputsObj)[0]];
    const data = output.data;
    const dims = output.dims; // [1, 5, 8400]

    let numDetections, numFeatures, isTransposed;
    if (dims[1] > dims[2]) {
        numDetections = dims[1];
        numFeatures = dims[2];
        isTransposed = true;
    } else {
        numDetections = dims[2];
        numFeatures = dims[1];
        isTransposed = false;
    }

    const detections = [];
    // YOLOv8n-barcode usually has 1 class
    const numClasses = numFeatures - 4;

    for (let i = 0; i < numDetections; i++) {
        let maxScore = 0;
        for (let c = 0; c < numClasses; c++) {
            const score = isTransposed
                ? data[i * numFeatures + (c + 4)]
                : data[numDetections * (c + 4) + i];
            if (score > maxScore) maxScore = score;
        }

        if (maxScore > threshold) {
            const x_center = isTransposed ? data[i * numFeatures + 0] : data[numDetections * 0 + i];
            const y_center = isTransposed ? data[i * numFeatures + 1] : data[numDetections * 1 + i];
            const w = isTransposed ? data[i * numFeatures + 2] : data[numDetections * 2 + i];
            const h = isTransposed ? data[i * numFeatures + 3] : data[numDetections * 3 + i];

            detections.push({
                x: (x_center - w / 2) * (width / YOLO_INPUT_SIZE),
                y: (y_center - h / 2) * (height / YOLO_INPUT_SIZE),
                w: w * (width / YOLO_INPUT_SIZE),
                h: h * (height / YOLO_INPUT_SIZE),
                confidence: maxScore
            });
        }
    }

    return nms(detections, 0.45);
}

function nms(boxes, threshold) {
    boxes.sort((a, b) => b.confidence - a.confidence);
    const picked = [];
    const suppressed = new Set();

    for (let i = 0; i < boxes.length; i++) {
        if (suppressed.has(i)) continue;
        picked.push(boxes[i]);
        for (let j = i + 1; j < boxes.length; j++) {
            if (suppressed.has(j)) continue;
            if (iou(boxes[i], boxes[j]) > threshold) suppressed.add(j);
        }
    }
    return picked;
}

function iou(boxA, boxB) {
    const xA = Math.max(boxA.x, boxB.x);
    const yA = Math.max(boxA.y, boxB.y);
    const xB = Math.min(boxA.x + boxA.w, boxB.x + boxB.w);
    const yB = Math.min(boxA.y + boxA.h, boxB.y + boxB.h);

    const interWidth = Math.max(0, xB - xA);
    const interHeight = Math.max(0, yB - yA);
    const interArea = interWidth * interHeight;

    const areaA = boxA.w * boxA.h;
    const areaB = boxB.w * boxB.h;
    const unionArea = areaA + areaB - interArea;

    return interArea / unionArea;
}
