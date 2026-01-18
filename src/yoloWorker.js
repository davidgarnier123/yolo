import * as ort from 'onnxruntime-web';

// Config ONNX for Browser/Vercel
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';

let session = null;
const YOLO_INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.3;

self.onmessage = async function (e) {
    const { type, payload } = e.data;

    if (type === 'LOAD_MODEL') {
        try {
            session = await ort.InferenceSession.create(payload.modelUrl, {
                executionProviders: ['wasm', 'webgl'],
                graphOptimizationLevel: 'all'
            });
            self.postMessage({ type: 'MODEL_LOADED' });
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: `Inference Error: ${err.message}` });
        }
    } else if (type === 'FRAME') {
        const { tensor, originalWidth, originalHeight } = payload;
        if (!session) return;

        try {
            // Inférence
            const outputs = await session.run({ images: tensor }); // YOLO standard name is 'images'
            const detections = processYOLOv8Output(outputs, originalWidth, originalHeight);

            self.postMessage({
                type: 'INFERENCE_RESULT',
                payload: { detections, originalWidth, originalHeight }
            });
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: `Inference Failed: ${err.message}` });
        }
    }
};

function processYOLOv8Output(outputsObj, width, height) {
    // Adaptation au format YOLOv8 (typiquement [1, 84, 8400])
    const output = outputsObj[Object.keys(outputsObj)[0]];
    const data = output.data;
    const dims = output.dims; // [1, 5, 8400] (x, y, w, h, score) ou [1, 84, 8400]

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
    const numClasses = numFeatures - 4;

    for (let i = 0; i < numDetections; i++) {
        let maxScore = 0;
        for (let c = 0; c < numClasses; c++) {
            const score = isTransposed
                ? data[i * numFeatures + (c + 4)]
                : data[numDetections * (c + 4) + i];
            if (score > maxScore) maxScore = score;
        }

        if (maxScore > CONFIDENCE_THRESHOLD) {
            const x_center = isTransposed ? data[i * numFeatures + 0] : data[numDetections * 0 + i];
            const y_center = isTransposed ? data[i * numFeatures + 1] : data[numDetections * 1 + i];
            const w = isTransposed ? data[i * numFeatures + 2] : data[numDetections * 2 + i];
            const h = isTransposed ? data[i * numFeatures + 3] : data[numDetections * 3 + i];

            // Conversion vers les coordonnées de l'image originale
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
    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = boxA.w * boxA.h;
    const boxBArea = boxB.w * boxB.h;
    return interArea / (boxAArea + boxBArea - interArea);
}
