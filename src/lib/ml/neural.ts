/**
 * Multilayer perceptron with hand-written backpropagation and Adam.
 *
 * Kept small and explicit rather than generic: a few dense layers, tanh or ReLU
 * hidden units, and either regression (identity output) or classification
 * (softmax + cross-entropy). This is the classifier/regressor used for fault
 * signature recognition and for learning a cheap surrogate of an expensive
 * simulation when the GP's O(n³) solve stops scaling.
 *
 * Every training run reports held-out accuracy/loss when a validation split is
 * supplied. Train-set loss alone is not offered as a quality claim.
 */

import { createRandomSource, shuffleInPlace, type RandomSource } from './random'

export type HiddenActivation = 'tanh' | 'relu' | 'logistic'

export interface NeuralNetworkOptions {
  /** Hidden layer widths, e.g. [8, 6]. */
  hiddenLayers: number[]
  /** Outputs: 1 = regression, ≥2 = classification with softmax. */
  outputs: number
  activation?: HiddenActivation
  learningRate?: number
  epochs?: number
  miniBatchSize?: number
  /** Stratified validation split fraction, 0 disables. Default 0.25. */
  validationSplit?: number
  seed?: number
  /** L2 penalty on the weights (Adam-style decoupled decay). */
  weightDecay?: number
}

export interface NeuralNetworkReport {
  epochs: number
  /** Loss on the training subset after the last epoch. */
  finalTrainLoss: number
  /** Loss on held-out data after the last epoch; null when no split was used. */
  finalValidationLoss: number | null
  /** Held-out classification accuracy; null for regression or when no split was used. */
  validationAccuracy: number | null
  /** Per-epoch training loss, for a convergence plot. */
  lossHistory: number[]
  /** Held-out loss per epoch — the curve that shows over-fitting. */
  validationHistory: number[]
  trainSize: number
  validationSize: number
  parameterCount: number
  activation: HiddenActivation
  outputs: number
}

export interface TrainedNetwork {
  predict(features: readonly number[]): number[]
  /** Argmax for classification; the raw scalar for regression. */
  classify(features: readonly number[]): number
  report: NeuralNetworkReport
  layers: number[]
}

function activate(x: number, kind: HiddenActivation): number {
  switch (kind) {
    case 'tanh': return Math.tanh(x)
    case 'relu': return x > 0 ? x : 0
    case 'logistic': return 1 / (1 + Math.exp(-clampExponent(x)))
  }
}

function clampExponent(x: number): number {
  // exp() overflows past ~709; a saturated logistic is the correct answer, not NaN.
  return Math.min(700, Math.max(-700, x))
}

/** Derivative from the already-computed activation, which is how backprop stays cheap. */
function activationGradient(output: number, kind: HiddenActivation): number {
  switch (kind) {
    case 'tanh': return 1 - output * output
    case 'relu': return output > 0 ? 1 : 0
    case 'logistic': return output * (1 - output)
  }
}

function softmax(scores: readonly number[]): number[] {
  const max = Math.max(...scores)
  const exponentials = scores.map((score) => Math.exp(clampExponent(score - max)))
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  if (total === 0) return scores.map(() => 1 / scores.length)
  return exponentials.map((value) => value / total)
}

interface Layer {
  weights: number[][]
  biases: number[]
  /** Adam moment caches, shaped to the weights. */
  weightMoment: number[][]
  biasMoment: number[]
  weightSecond: number[][]
  biasSecond: number[]
}

function randomMatrix(rows: number, columns: number, limit: number, random: RandomSource): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => random.range(-limit, limit)),
  )
}

function validateDataset(inputs: readonly (readonly number[])[], targets: readonly number[], outputs: number): number {
  if (inputs.length === 0) throw new Error('A neural network needs at least one training sample.')
  const features = inputs[0].length
  if (features === 0) throw new Error('A neural network needs at least one input feature.')
  if (inputs.some((row) => row.length !== features)) throw new Error('Ragged input matrix.')
  if (targets.length !== inputs.length) throw new Error('Sample and target counts disagree.')
  if (inputs.some((row) => row.some((value) => !Number.isFinite(value)))) throw new Error('Inputs must all be finite.')
  if (outputs === 1) {
    if (targets.some((value) => !Number.isFinite(value))) throw new Error('Regression targets must be finite.')
  } else {
    if (targets.some((value) => !Number.isInteger(value) || value < 0 || value >= outputs)) {
      throw new Error(`Classification targets must be integers in 0..${outputs - 1}.`)
    }
  }
  return features
}

/**
 * Split for validation. Classification uses a stratified split so a rare class
 * cannot land entirely in one half and make a 100 % held-out score meaningless;
 * regression uses a plain seeded shuffle, since a float target has no classes.
 */
function splitIndices(
  targets: readonly number[],
  fraction: number,
  random: RandomSource,
  classification: boolean,
): { train: number[]; validation: number[] } {
  const train: number[] = []
  const validation: number[] = []

  if (!classification) {
    const order = Array.from({ length: targets.length }, (_, i) => i)
    shuffleInPlace(order, random)
    const validationCount = Math.round(targets.length * fraction)
    validation.push(...order.slice(0, validationCount))
    train.push(...order.slice(validationCount))
    shuffleInPlace(train, random)
    return { train, validation }
  }

  const byClass = new Map<number, number[]>()
  targets.forEach((target, index) => {
    const bucket = byClass.get(target) ?? []
    bucket.push(index)
    byClass.set(target, bucket)
  })

  for (const bucket of byClass.values()) {
    shuffleInPlace(bucket, random)
    // A class with a single member goes to training: a class never trained on
    // would depress the held-out score for reasons that have nothing to do with
    // the model's generalisation.
    const validationCount = Math.max(0, Math.min(bucket.length - 1, Math.round(bucket.length * fraction)))
    validation.push(...bucket.slice(0, validationCount))
    train.push(...bucket.slice(validationCount))
  }
  shuffleInPlace(train, random)
  return { train, validation }
}

export function trainNeuralNetwork(
  inputs: readonly (readonly number[])[],
  targets: readonly number[],
  options: NeuralNetworkOptions,
): TrainedNetwork {
  // Shape errors first, data errors second: an illegal output count makes the
  // target-range check meaningless ("integers in 0..-1" tells nobody that the
  // caller passed outputs: 0), so validating the dataset before it misreports
  // the cause.
  const outputs = options.outputs
  if (!Number.isInteger(outputs) || outputs < 1) throw new Error(`Output count must be a positive integer, got ${outputs}.`)
  if (options.hiddenLayers.length === 0) throw new Error('Provide at least one hidden layer.')
  if (options.hiddenLayers.some((width) => !Number.isInteger(width) || width < 1)) {
    throw new Error(`Every hidden layer needs a positive integer width, got ${options.hiddenLayers.join(', ')}.`)
  }
  const features = validateDataset(inputs, targets, outputs)
  const activation = options.activation ?? 'tanh'
  const learningRate = options.learningRate ?? 0.01
  if (!(learningRate > 0) || !Number.isFinite(learningRate)) throw new Error(`Learning rate must be positive and finite, got ${learningRate}.`)
  const epochs = options.epochs ?? 300
  if (!Number.isInteger(epochs) || epochs < 1) throw new Error(`Epoch count must be a positive integer, got ${epochs}.`)
  const weightDecay = options.weightDecay ?? 0
  if (!(weightDecay >= 0) || !Number.isFinite(weightDecay)) throw new Error(`Weight decay must be ≥ 0, got ${weightDecay}.`)
  const validationSplit = options.validationSplit ?? 0.25
  if (!(validationSplit >= 0 && validationSplit < 0.9)) throw new Error(`Validation split must be in [0, 0.9), got ${validationSplit}.`)

  const random = createRandomSource(options.seed ?? 1234)
  const sizes = [features, ...options.hiddenLayers, outputs]

  const layers: Layer[] = []
  for (let l = 1; l < sizes.length; l += 1) {
    const fanIn = sizes[l - 1]
    // He/Glorot-style scaling: a fixed ±1 init saturates tanh and kills the gradient.
    const limit = Math.sqrt(6 / (fanIn + sizes[l]))
    layers.push({
      weights: randomMatrix(sizes[l], fanIn, limit, random),
      biases: new Array<number>(sizes[l]).fill(0),
      weightMoment: Array.from({ length: sizes[l] }, () => new Array<number>(fanIn).fill(0)),
      biasMoment: new Array<number>(sizes[l]).fill(0),
      weightSecond: Array.from({ length: sizes[l] }, () => new Array<number>(fanIn).fill(0)),
      biasSecond: new Array<number>(sizes[l]).fill(0),
    })
  }

  const trainIndices: number[] = []
  const validationIndices: number[] = []
  if (validationSplit > 0 && inputs.length >= 8) {
    const split = splitIndices(targets, validationSplit, random, outputs > 1)
    trainIndices.push(...split.train)
    validationIndices.push(...split.validation)
  } else {
    for (let i = 0; i < inputs.length; i += 1) trainIndices.push(i)
  }
  if (trainIndices.length === 0) throw new Error('Splitting left no training samples.')

  const miniBatchSize = options.miniBatchSize ?? Math.max(1, Math.min(32, Math.ceil(trainIndices.length / 8)))
  if (!Number.isInteger(miniBatchSize) || miniBatchSize < 1) throw new Error(`Mini-batch size must be a positive integer, got ${miniBatchSize}.`)

  const lossHistory: number[] = []
  const validationHistory: number[] = []
  let finalTrainLoss = 0
  let finalValidationLoss: number | null = null
  let validationAccuracy: number | null = null

  const beta1 = 0.9
  const beta2 = 0.999
  const epsilon = 1e-8
  let step = 0

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const order = [...trainIndices]
    shuffleInPlace(order, random)
    let epochLossSum = 0
    let epochCount = 0

    for (let start = 0; start < order.length; start += miniBatchSize) {
      const batch = order.slice(start, start + miniBatchSize)
      const accumulators = layers.map((layer) => ({
        weights: layer.weights.map((row) => row.map(() => 0)),
        biases: new Array<number>(layer.biases.length).fill(0),
      }))

      for (const index of batch) {
        const { loss, gradients } = backpropagate(layers, inputs[index], targets[index], activation, outputs)
        epochLossSum += loss
        epochCount += 1
        for (let l = 0; l < layers.length; l += 1) {
          for (let j = 0; j < accumulators[l].biases.length; j += 1) {
            accumulators[l].biases[j] += gradients[l].biases[j]
            for (let k = 0; k < accumulators[l].weights[j].length; k += 1) {
              accumulators[l].weights[j][k] += gradients[l].weights[j][k]
            }
          }
        }
      }

      // Mini-batch gradient is the mean, so the learning rate means the same
      // thing at batch 1 as at batch 32.
      for (let l = 0; l < layers.length; l += 1) {
        for (let j = 0; j < accumulators[l].biases.length; j += 1) {
          accumulators[l].biases[j] /= batch.length
          for (let k = 0; k < accumulators[l].weights[j].length; k += 1) {
            accumulators[l].weights[j][k] /= batch.length
          }
        }
      }

      step += 1
      const biasCorrection1 = 1 - beta1 ** step
      const biasCorrection2 = 1 - beta2 ** step
      applyAdam(layers, accumulators, learningRate, beta1, beta2, epsilon, biasCorrection1, biasCorrection2, weightDecay)
    }

    const trainLoss = epochCount > 0 ? epochLossSum / epochCount : Number.NaN
    lossHistory.push(trainLoss)
    finalTrainLoss = trainLoss

    if (validationIndices.length > 0) {
      const scored = scoreSet(layers, validationIndices, inputs, targets, activation, outputs)
      validationHistory.push(scored.loss)
      finalValidationLoss = scored.loss
      if (outputs > 1) validationAccuracy = scored.accuracy
    }
  }

  const parameterCount = layers.reduce(
    (sum, layer) => sum + layer.weights.reduce((inner, row) => inner + row.length, 0) + layer.biases.length,
    0,
  )

  const forwardOnly = (row: readonly number[]): number[] => forward(layers, row, activation)

  return {
    layers: sizes,
    predict(featuresIn: readonly number[]): number[] {
      if (featuresIn.length !== features) throw new Error(`Network expects ${features} inputs, got ${featuresIn.length}.`)
      const out = forwardOnly(featuresIn)
      return outputs === 1 ? out : softmax(out)
    },
    classify(featuresIn: readonly number[]): number {
      if (outputs === 1) return forwardOnly(featuresIn)[0]
      const probabilities = softmax(forwardOnly(featuresIn))
      let best = 0
      for (let i = 1; i < probabilities.length; i += 1) if (probabilities[i] > probabilities[best]) best = i
      return best
    },
    report: {
      epochs,
      finalTrainLoss,
      finalValidationLoss,
      validationAccuracy,
      lossHistory,
      validationHistory,
      trainSize: trainIndices.length,
      validationSize: validationIndices.length,
      parameterCount,
      activation,
      outputs,
    },
  }
}

function forward(layers: Layer[], input: readonly number[], activation: HiddenActivation): number[] {
  const outputs = forwardWithCache(layers, input, activation).outputs
  return outputs[outputs.length - 1]
}

interface LayerCache {
  /** Layer outputs after activation (the last one is the network output). */
  outputs: number[][]
}

function forwardWithCache(layers: Layer[], input: readonly number[], activation: HiddenActivation): LayerCache {
  const outs: number[][] = []
  let activations = [...input]
  for (let l = 0; l < layers.length; l += 1) {
    const layer = layers[l]
    const before = layer.weights.map((row, j) => {
      let sum = layer.biases[j]
      for (let k = 0; k < row.length; k += 1) sum += row[k] * activations[k]
      return sum
    })
    const after = l === layers.length - 1 ? before : before.map((value) => activate(value, activation))
    outs.push(after)
    activations = after
  }
  return { outputs: outs }
}

/**
 * One-sample backprop. Returns the sample loss and the gradients for every
 * weight and bias; the caller accumulates them across the mini-batch.
 */
function backpropagate(
  layers: Layer[],
  input: readonly number[],
  target: number,
  activation: HiddenActivation,
  outputs: number,
): {
  loss: number
  gradients: Array<{ weights: number[][]; biases: number[] }>
} {
  const cache = forwardWithCache(layers, input, activation)
  const gradients = layers.map((layer) => ({
    weights: layer.weights.map((row) => row.map(() => 0)),
    biases: new Array<number>(layer.biases.length).fill(0),
  }))

  const last = cache.outputs[cache.outputs.length - 1]
  let delta: number[]

  if (outputs === 1) {
    // ½(y−t)² with identity output → dL/dz = (y − t).
    const error = last[0] - target
    if (!Number.isFinite(error)) {
      throw new Error(`Regression produced a non-finite output (${error}); the network is diverging — lower the learning rate or rescale the targets.`)
    }
    delta = [error]
  } else {
    const probabilities = softmax(last)
    // Softmax + cross-entropy collapses to (p − onehot), which is why this
    // pairing is used instead of a logistic output.
    delta = probabilities.map((probability, index) => probability - (index === target ? 1 : 0))
  }

  for (let l = layers.length - 1; l >= 0; l -= 1) {
    const layerInput = cache.outputs[l - 1] ?? [...input]
    for (let j = 0; j < layers[l].weights.length; j += 1) {
      gradients[l].biases[j] += delta[j]
      const row = layers[l].weights[j]
      for (let k = 0; k < row.length; k += 1) gradients[l].weights[j][k] += delta[j] * layerInput[k]
    }
    if (l === 0) break
    const upstream = delta
    delta = layers[l].weights.map(() => 0)
    for (let k = 0; k < layerInput.length; k += 1) {
      let sum = 0
      for (let j = 0; j < layers[l].weights.length; j += 1) sum += layers[l].weights[j][k] * upstream[j]
      delta[k] = sum * activationGradient(layerInput[k], activation)
    }
  }

  return { loss: sampleLoss(cache.outputs[cache.outputs.length - 1], target, outputs), gradients }
}

function sampleLoss(output: readonly number[], target: number, outputs: number): number {
  if (outputs === 1) {
    const error = output[0] - target
    return 0.5 * error * error
  }
  const probabilities = softmax(output)
  const selected = probabilities[target]
  // The −log() floor is ε-clipped so an exact 0 probability is a large finite
  // loss, not Infinity that silently poisons the epoch average.
  return -Math.log(Math.max(selected, 1e-12))
}

function applyAdam(
  layers: Layer[],
  gradients: Array<{ weights: number[][]; biases: number[] }>,
  learningRate: number,
  beta1: number,
  beta2: number,
  epsilon: number,
  biasCorrection1: number,
  biasCorrection2: number,
  weightDecay: number,
): void {
  for (let l = 0; l < layers.length; l += 1) {
    const layer = layers[l]
    for (let j = 0; j < layer.weights.length; j += 1) {
      for (let k = 0; k < layer.weights[j].length; k += 1) {
        const g = gradients[l].weights[j][k]
        layer.weightMoment[j][k] = beta1 * layer.weightMoment[j][k] + (1 - beta1) * g
        layer.weightSecond[j][k] = beta2 * layer.weightSecond[j][k] + (1 - beta2) * g * g
        const estimate = layer.weightMoment[j][k] / biasCorrection1
        const secondEstimate = layer.weightSecond[j][k] / biasCorrection2
        layer.weights[j][k] -= learningRate * (estimate / (Math.sqrt(secondEstimate) + epsilon) + weightDecay * layer.weights[j][k])
      }
      const gb = gradients[l].biases[j]
      layer.biasMoment[j] = beta1 * layer.biasMoment[j] + (1 - beta1) * gb
      layer.biasSecond[j] = beta2 * layer.biasSecond[j] + (1 - beta2) * gb * gb
      layer.biases[j] -= learningRate * (layer.biasMoment[j] / biasCorrection1) / (Math.sqrt(layer.biasSecond[j] / biasCorrection2) + epsilon)
    }
    assertFiniteWeights(layer)
  }
}

function assertFiniteWeights(layer: Layer): void {
  for (let j = 0; j < layer.weights.length; j += 1) {
    if (!Number.isFinite(layer.biases[j])) throw new Error('Adam produced a non-finite bias; reduce the learning rate.')
    for (let k = 0; k < layer.weights[j].length; k += 1) {
      if (!Number.isFinite(layer.weights[j][k])) throw new Error('Adam produced a non-finite weight; reduce the learning rate.')
    }
  }
}

function scoreSet(
  layers: Layer[],
  indices: readonly number[],
  inputs: readonly (readonly number[])[],
  targets: readonly number[],
  activation: HiddenActivation,
  outputs: number,
): { loss: number; accuracy: number } {
  let loss = 0
  let correct = 0
  for (const index of indices) {
    const output = forward(layers, inputs[index], activation)
    loss += sampleLoss(output, targets[index], outputs)
    if (outputs > 1) {
      let best = 0
      for (let i = 1; i < output.length; i += 1) if (output[i] > output[best]) best = i
      if (best === targets[index]) correct += 1
    }
  }
  return { loss: loss / indices.length, accuracy: indices.length === 0 ? Number.NaN : correct / indices.length }
}
