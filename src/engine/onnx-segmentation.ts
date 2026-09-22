import * as ort from 'onnxruntime-web';
import { decodeSegmentationOutput, NUM_CLASSES, type SegmentationResult } from './algorithms';

// Tell onnxruntime where to find its WASM files
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';

let session: ort.InferenceSession | null = null;

export async function loadRoadModel(): Promise<ort.InferenceSession> {
    if (session) return session;

    const modelPath = `${import.meta.env.BASE_URL}models/road_seg.onnx`;
    session = await ort.InferenceSession.create(modelPath, {
        executionProviders: ['wasm'],
    });

    console.log('ONNX model loaded successfully');
    console.log('Input names:', session.inputNames.join(","));
    console.log('Output names:', session.outputNames.join(","));

    return session;
}

// ─── GABOR KERNEL GENERATOR (Aligned with OpenCV getGaborKernel) ──────
function getGaborKernel(
  ksize: number,
  sigma: number,
  theta: number,
  lambd: number,
  gamma: number,
  psi: number
): Float32Array {
  const kernel = new Float32Array(ksize * ksize);
  const halfSize = Math.floor(ksize / 2);

  for (let y = -halfSize; y <= halfSize; y++) {
    for (let x = -halfSize; x <= halfSize; x++) {
      const xPrime = x * Math.cos(theta) + y * Math.sin(theta);
      const yPrime = -x * Math.sin(theta) + y * Math.cos(theta);
      
      const expTerm = Math.exp(
        -0.5 * (Math.pow(xPrime / sigma, 2) + Math.pow((yPrime * gamma) / sigma, 2))
      );
      const cosTerm = Math.cos((2 * Math.PI * xPrime) / lambd + psi);
      
      kernel[(y + halfSize) * ksize + (x + halfSize)] = expTerm * cosTerm;
    }
  }
  return kernel;
}

// ─── CACHE KERNELS (Matches Python: np.arange(0, np.pi, np.pi / 4)) ───
const _GABOR_KERNELS: Float32Array[] = [];
(function initGaborKernels() {
  const thetas = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4];
  const freqs = [0.1, 0.25];
  
  for (const theta of thetas) {
    for (const freq of freqs) {
      _GABOR_KERNELS.push(
        getGaborKernel(21, 4.0, theta, 1.0 / freq, 0.5, 0)
      );
    }
  }
})();

// ─── 2D CONVOLUTION (Replicates cv2.filter2D with BORDER_REFLECT_101,
// OpenCV's default border mode -- mirrors without repeating the edge
// pixel, e.g. ...c b|a b c d|c b... NOT ...a a|a b c d|d d... which is
// what simple clamping gives you. Matters near image edges.) ─────────
function reflect101(i: number, n: number): number {
  if (n === 1) return 0;
  while (i < 0 || i >= n) {
    if (i < 0) i = -i;
    if (i >= n) i = 2 * (n - 1) - i;
  }
  return i;
}

function convolve(
  image: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
  ksize: number
): Float32Array {
  const out = new Float32Array(width * height);
  const halfSize = Math.floor(ksize / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let ky = -halfSize; ky <= halfSize; ky++) {
        for (let kx = -halfSize; kx <= halfSize; kx++) {
          const iy = reflect101(y + ky, height);
          const ix = reflect101(x + kx, width);
          
          const kVal = kernel[(ky + halfSize) * ksize + (kx + halfSize)];
          sum += image[iy * width + ix] * kVal;
        }
      }
      out[y * width + x] = sum;
    }
  }
  return out;
}

// ─── TENSOR BUILDERS ──────────────────────────────────────────────────
function resizeImageData(imageData: ImageData, targetSize: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d')!;

  const tmp = document.createElement('canvas');
  tmp.width = imageData.width;
  tmp.height = imageData.height;
  tmp.getContext('2d')!.putImageData(imageData, 0, 0);

  ctx.drawImage(tmp, 0, 0, targetSize, targetSize);
  return ctx.getImageData(0, 0, targetSize, targetSize).data;
}

function buildRgbTensor(imageData: ImageData, targetSize: number): ort.Tensor {
  const rgba = resizeImageData(imageData, targetSize);
  const float32Data = new Float32Array(targetSize * targetSize * 3);
  
  for (let i = 0; i < targetSize * targetSize; i++) {
    // Corrected to match Python's [0.0, 1.0] scaling (/ 255.0)
    float32Data[i * 3]     = rgba[i * 4] / 255.0;       // R
    float32Data[i * 3 + 1] = rgba[i * 4 + 1] / 255.0;   // G
    float32Data[i * 3 + 2] = rgba[i * 4 + 2] / 255.0;   // B
  }
  
  return new ort.Tensor('float32', float32Data, [1, targetSize, targetSize, 3]);
}

export function buildGaborTensor(imageData: ImageData, targetSize: number): ort.Tensor {
  const rgba = resizeImageData(imageData, targetSize);
  const width = targetSize;
  const height = targetSize;
  const numPixels = width * height;
  
  const gray = new Float32Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  const numKernels = _GABOR_KERNELS.length;
  const responses: Float32Array[] = [];
  for (let k = 0; k < numKernels; k++) {
    responses.push(convolve(gray, width, height, _GABOR_KERNELS[k], 21));
  }

  const energy = new Float32Array(numPixels);
  let minVal = Infinity;
  let maxVal = -Infinity;

  for (let i = 0; i < numPixels; i++) {
    let sum = 0;
    for (let k = 0; k < numKernels; k++) {
      sum += responses[k][i];
    }
    const mean = sum / numKernels;

    let varSum = 0;
    for (let k = 0; k < numKernels; k++) {
      const diff = responses[k][i] - mean;
      varSum += diff * diff;
    }
    
    const std = Math.sqrt(varSum / numKernels);
    energy[i] = std;

    if (std < minVal) minVal = std;
    if (std > maxVal) maxVal = std;
  }

  const finalArray = new Float32Array(numPixels);
  const range = maxVal - minVal;
  
  for (let i = 0; i < numPixels; i++) {
    const norm = range === 0 ? 0 : (energy[i] - minVal) / range;
    finalArray[i] = 1.0 - norm;
  }

  return new ort.Tensor('float32', finalArray, [1, height, width, 1]);
}

// ─── PIPELINE EXECUTION ───────────────────────────────────────────────
export async function onnxSegmentation(
    imageData: ImageData
): Promise<SegmentationResult> {
    const session = await loadRoadModel();

    const size = 256;

    const rgbTensor = buildRgbTensor(imageData, size);
    const gaborTensor = buildGaborTensor(imageData, size);

    const feeds: Record<string, ort.Tensor> = {};
    const inputNames = session.inputNames;
    
    if (inputNames.includes('rgb') && inputNames.includes('gabor')) {
        feeds['rgb'] = rgbTensor;
        feeds['gabor'] = gaborTensor;
    } else {
        feeds[inputNames[0]] = rgbTensor; 
        if (inputNames.length > 1) {
            feeds[inputNames[1]] = gaborTensor;
        }
    }

    console.log("RGB dims =", rgbTensor.dims.join(","));
    console.log("Gabor dims =", gaborTensor.dims.join(","));
    console.log("Input names =", session.inputNames.join(","));
    console.log("Output names =", session.outputNames.join(","));

    const results = await session.run(feeds);
    const output = results[session.outputNames[0]];

    console.log("Output dims =", output.dims.join(","));
    const outputData = output.data as Float32Array;

    // fix: was deriving numClasses from dims[3] (assumes NHWC) then using
    // that same guessed value to test for NCHW -- circular, and silently
    // wrong if the export is ever NCHW ([1,C,H,W]), since dims[3] would
    // then be image width, not the class count. Use the known class
    // count as ground truth instead of inferring it from the layout
    // we're trying to detect.
    const isNCHW = output.dims[1] === NUM_CLASSES;
    const numClasses = isNCHW ? output.dims[1] : output.dims[3];

    // Delegate full multichannel argmax decoding to decodeSegmentationOutput from algorithms.ts
    const result = decodeSegmentationOutput(outputData, size, size, numClasses, isNCHW);

    // Resize or project mask back to original incoming image dimensions if necessary
    if (result.width !== imageData.width || result.height !== imageData.height) {
        const scaledMask = new Uint8Array(imageData.width * imageData.height);
        for (let y = 0; y < imageData.height; y++) {
            for (let x = 0; x < imageData.width; x++) {
                const srcX = Math.floor((x * size) / imageData.width);
                const srcY = Math.floor((y * size) / imageData.height);
                scaledMask[y * imageData.width + x] = result.mask[srcY * size + srcX];
            }
        }
        return {
            mask: scaledMask,
            width: imageData.width,
            height: imageData.height,
        };
    }

    return result;
}