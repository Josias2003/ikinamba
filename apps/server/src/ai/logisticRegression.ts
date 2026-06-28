import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, "models");

export interface LogisticModel {
  weights: number[];
  bias: number;
  featureMeans: number[];
  featureStds: number[];
  featureNames: string[];
  trainedAt: string;
  trainingSize: number;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function standardize(features: number[][], means: number[], stds: number[]): number[][] {
  return features.map((row) => row.map((v, i) => (stds[i] === 0 ? 0 : (v - means[i]) / stds[i])));
}

function computeMeansAndStds(features: number[][]): { means: number[]; stds: number[] } {
  const n = features.length;
  const dims = features[0]?.length ?? 0;
  const means = Array(dims).fill(0);
  for (const row of features) for (let i = 0; i < dims; i++) means[i] += row[i] / n;
  const stds = Array(dims).fill(0);
  for (const row of features) for (let i = 0; i < dims; i++) stds[i] += (row[i] - means[i]) ** 2 / n;
  return { means, stds: stds.map((v) => Math.sqrt(v) || 1) };
}

/** Trains a binary logistic regression via batch gradient descent. Small in-process trainer
 * (no Python/sklearn dependency) -- appropriate scale for an SME-sized dataset and a solo full-stack build. */
export function trainLogisticRegression(
  rawFeatures: number[][],
  labels: number[],
  featureNames: string[],
  opts: { epochs?: number; learningRate?: number; l2 ?: number } = {}
): LogisticModel {
  const { epochs = 2000, learningRate = 0.1, l2 = 0.001 } = opts;
  const { means, stds } = computeMeansAndStds(rawFeatures);
  const X = standardize(rawFeatures, means, stds);
  const n = X.length;
  const dims = featureNames.length;

  let weights = Array(dims).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = Array(dims).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((sum, x, j) => sum + x * weights[j], bias);
      const pred = sigmoid(z);
      const error = pred - labels[i];
      for (let j = 0; j < dims; j++) gradW[j] += (error * X[i][j]) / n;
      gradB += error / n;
    }

    weights = weights.map((w, j) => w - learningRate * (gradW[j] + l2 * w));
    bias -= learningRate * gradB;
  }

  return {
    weights,
    bias,
    featureMeans: means,
    featureStds: stds,
    featureNames,
    trainedAt: new Date().toISOString(),
    trainingSize: n,
  };
}

export function scoreWithModel(model: LogisticModel, rawFeatureVector: number[]): number {
  const standardized = rawFeatureVector.map((v, i) =>
    model.featureStds[i] === 0 ? 0 : (v - model.featureMeans[i]) / model.featureStds[i]
  );
  const z = standardized.reduce((sum, x, j) => sum + x * model.weights[j], model.bias);
  return sigmoid(z);
}

export function saveModel(name: string, model: LogisticModel) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.writeFileSync(path.join(MODELS_DIR, `${name}.json`), JSON.stringify(model, null, 2));
}

const modelCache = new Map<string, LogisticModel>();

export function loadModel(name: string): LogisticModel | undefined {
  if (modelCache.has(name)) return modelCache.get(name);
  const file = path.join(MODELS_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return undefined;
  const model = JSON.parse(fs.readFileSync(file, "utf-8")) as LogisticModel;
  modelCache.set(name, model);
  return model;
}
