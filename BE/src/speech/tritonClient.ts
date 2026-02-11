/**
 * Triton Inference Server gRPC Client
 * 
 * Note: This requires Triton protobuf files. Download from:
 * https://github.com/triton-inference-server/common/tree/main/protobuf
 * Place grpc_service.proto and model_config.proto in src/speech/proto/
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { logger } from '../utils/logger';
import path from 'path';

const getTritonUrl = () => process.env.TRITON_GRPC_URL || 'localhost:8001';
const getSttModelName = () => process.env.TRITON_STT_MODEL || 'whisper';
const getTtsModelName = () => process.env.TRITON_TTS_MODEL || 'vits';

// Singleton gRPC client
let grpcClient: any = null;
let isConnected = false;

/**
 * Data type mapping for Triton tensors
 */
const TRITON_DATATYPE = {
  BOOL: 'BOOL',
  UINT8: 'UINT8',
  UINT16: 'UINT16',
  UINT32: 'UINT32',
  UINT64: 'UINT64',
  INT8: 'INT8',
  INT16: 'INT16',
  INT32: 'INT32',
  INT64: 'INT64',
  FP16: 'FP16',
  FP32: 'FP32',
  FP64: 'FP64',
  BYTES: 'BYTES',
};

/**
 * Convert TypedArray dtype to Triton datatype string
 */
const getTritonDatatype = (data: any): string => {
  if (data instanceof Float32Array) return TRITON_DATATYPE.FP32;
  if (data instanceof Float64Array) return TRITON_DATATYPE.FP64;
  if (data instanceof Int16Array) return TRITON_DATATYPE.INT16;
  if (data instanceof Int32Array) return TRITON_DATATYPE.INT32;
  if (data instanceof Uint8Array) return TRITON_DATATYPE.UINT8;
  if (Array.isArray(data) && typeof data[0] === 'string') return TRITON_DATATYPE.BYTES;
  return TRITON_DATATYPE.FP32; // Default
};

/**
 * Connect to Triton Inference Server
 */
export const connectTriton = async (): Promise<void> => {
  if (isConnected && grpcClient) {
    return;
  }

  const tritonUrl = getTritonUrl();
  logger.info(`Connecting to Triton at ${tritonUrl}...`);

  try {
    // Load proto file
    const PROTO_PATH = path.join(__dirname, 'proto', 'grpc_service.proto');
    
    // For now, we'll create a simple HTTP-based client as fallback
    // TODO: Implement full gRPC client with proto files
    
    const packageDefinition = protoLoader.loadSync(
      PROTO_PATH,
      {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true
      }
    );

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    const inference = (protoDescriptor.inference as any);

    grpcClient = new inference.GRPCInferenceService(
      tritonUrl,
      grpc.credentials.createInsecure()
    );

    isConnected = true;
    logger.info('✓ Connected to Triton Inference Server');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to connect to Triton: ${message}`);
    // Fallback to HTTP REST API
    logger.warn('Will use HTTP REST API as fallback');
    isConnected = false;
    throw error;
  }
};

/**
 * Check if Triton server is alive
 */
export const isTritonAlive = async (): Promise<boolean> => {
  if (!isConnected) return false;

  try {
    // Simple health check using HTTP
    const tritonUrl = getTritonUrl().replace(':8001', ':8000');
    const response = await fetch(`http://${tritonUrl}/v2/health/live`);
    return response.ok;
  } catch (error) {
    return false;
  }
};

/**
 * Check if a specific model is ready
 */
export const isTritonModelReady = async (modelName: string): Promise<boolean> => {
  try {
    const tritonUrl = getTritonUrl().replace(':8001', ':8000');
    const response = await fetch(`http://${tritonUrl}/v2/models/${modelName}/ready`);
    return response.ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Error checking model ${modelName}: ${message}`);
    return false;
  }
};

/**
 * Perform inference using HTTP REST API (fallback)
 */
const inferHttp = async (
  modelName: string,
  inputs: Record<string, any>,
  outputs: string[]
): Promise<Record<string, any>> => {
  const tritonUrl = getTritonUrl().replace(':8001', ':8000');
  const url = `http://${tritonUrl}/v2/models/${modelName}/infer`;

  // Prepare inputs
  const inputsArray = Object.entries(inputs).map(([name, data]) => {
    let shape: number[];
    let dataArray: any[];

    if (data instanceof Float32Array || data instanceof Int16Array) {
      shape = [data.length];
      dataArray = Array.from(data);
    } else if (Array.isArray(data)) {
      shape = [data.length];
      dataArray = data;
    } else {
      shape = [1];
      dataArray = [data];
    }

    return {
      name,
      shape,
      datatype: getTritonDatatype(data),
      data: dataArray,
    };
  });

  // Prepare outputs
  const outputsArray = outputs.map(name => ({ name }));

  const requestBody = {
    inputs: inputsArray,
    outputs: outputsArray,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Triton inference failed: ${error}`);
  }

  const result = await response.json();

  // Parse outputs
  const outputData: Record<string, any> = {};
  for (const output of result.outputs) {
    const name = output.name;
    const data = output.data;
    const datatype = output.datatype;

    // Convert back to appropriate type
    if (datatype === TRITON_DATATYPE.FP32) {
      outputData[name] = new Float32Array(data);
    } else if (datatype === TRITON_DATATYPE.BYTES || datatype === 'BYTES') {
      // String output
      outputData[name] = data[0] || '';
    } else {
      outputData[name] = data;
    }
  }

  return outputData;
};

/**
 * Perform inference on Triton model
 */
export const inferTriton = async (
  modelName: string,
  inputs: Record<string, Float32Array | Int16Array | string[]>,
  outputs: string[]
): Promise<Record<string, any>> => {
  try {
    // Use HTTP REST API (more compatible)
    return await inferHttp(modelName, inputs, outputs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Triton inference failed for model ${modelName}: ${message}`);
    throw error;
  }
};

/**
 * Disconnect from Triton
 */
export const disconnectTriton = (): void => {
  if (grpcClient) {
    grpcClient.close();
    grpcClient = null;
  }
  isConnected = false;
  logger.info('Disconnected from Triton');
};

// Export model names for convenience
export const STT_MODEL = getSttModelName;
export const TTS_MODEL = getTtsModelName;
