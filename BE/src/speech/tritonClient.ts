/**
 * Triton Inference Server gRPC Client
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
 * Connect to Triton Inference Server via gRPC
 */
export const connectTriton = async (): Promise<void> => {
  const tritonUrl = getTritonUrl();
  logger.info(`Connecting to Triton gRPC at ${tritonUrl}...`);

  try {
    const PROTO_PATH = path.join(__dirname, 'proto', 'grpc_service.proto');
    
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

    if (!inference || !inference.GRPCInferenceService) {
      throw new Error('Failed to load GRPCInferenceService from proto file');
    }

    grpcClient = new inference.GRPCInferenceService(
      tritonUrl,
      grpc.credentials.createInsecure()
    );

    // Test connection with ServerLive call
    await new Promise<void>((resolve, reject) => {
      grpcClient.ServerLive({}, (error: any, response: any) => {
        if (error) {
          reject(new Error(`gRPC ServerLive failed: ${error.message}`));
        } else if (response && response.live) {
          resolve();
        } else {
          reject(new Error('Triton server is not live'));
        }
      });
    });

    isConnected = true;
    logger.info('Connected to Triton Inference Server via gRPC');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`gRPC connection failed: ${message}`);
    logger.info('Falling back to HTTP REST API');
    isConnected = false;
    grpcClient = null;
  }
};

/**
 * Check if Triton server is alive (via gRPC or HTTP)
 */
export const isTritonAlive = async (): Promise<boolean> => {
  // Try gRPC first if connected
  if (isConnected && grpcClient) {
    try {
      const response = await new Promise<any>((resolve, reject) => {
        grpcClient.ServerLive({}, (error: any, response: any) => {
          if (error) reject(error);
          else resolve(response);
        });
      });
      return response && response.live;
    } catch (error) {
      logger.warn('gRPC ServerLive failed, falling back to HTTP');
      isConnected = false;
    }
  }

  // Fallback to HTTP
  try {
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
  // Try gRPC first if connected
  if (isConnected && grpcClient) {
    try {
      const response = await new Promise<any>((resolve, reject) => {
        grpcClient.ModelReady({ name: modelName }, (error: any, response: any) => {
          if (error) reject(error);
          else resolve(response);
        });
      });
      return response && response.ready;
    } catch (error) {
      logger.warn(`gRPC ModelReady failed for ${modelName}, falling back to HTTP`);
    }
  }

  // Fallback to HTTP
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
 * Perform inference using gRPC
 */
const inferGrpc = async (
  modelName: string,
  inputs: Record<string, any>,
  outputs: string[]
): Promise<Record<string, any>> => {
  if (!grpcClient) {
    throw new Error('gRPC client not connected');
  }

  // Prepare inputs
  const inputTensors = Object.entries(inputs).map(([name, data]) => {
    let shape: number[];
    let contents: any = {};
    const datatype = getTritonDatatype(data);

    if (data instanceof Float32Array) {
      shape = [data.length];
      contents.fp32_contents = Array.from(data);
    } else if (data instanceof Float64Array) {
      shape = [data.length];
      contents.fp64_contents = Array.from(data);
    } else if (data instanceof Int16Array || data instanceof Int32Array) {
      shape = [data.length];
      contents.int_contents = Array.from(data);
    } else if (Array.isArray(data) && typeof data[0] === 'string') {
      shape = [data.length];
      contents.bytes_contents = data.map((s: string) => Buffer.from(s, 'utf-8'));
    } else {
      shape = [1];
      contents.fp32_contents = [data];
    }

    return {
      name,
      datatype,
      shape,
      contents,
    };
  });

  // Prepare outputs
  const outputTensors = outputs.map(name => ({ name }));

  const request = {
    model_name: modelName,
    inputs: inputTensors,
    outputs: outputTensors,
  };

  // Call ModelInfer
  const response = await new Promise<any>((resolve, reject) => {
    grpcClient.ModelInfer(request, (error: any, response: any) => {
      if (error) {
        reject(new Error(`gRPC ModelInfer failed: ${error.message}`));
      } else {
        resolve(response);
      }
    });
  });

  // Parse outputs
  const outputData: Record<string, any> = {};
  for (const output of response.outputs) {
    const name = output.name;
    const datatype = output.datatype;
    const contents = output.contents;

    // Extract data based on type
    if (datatype === TRITON_DATATYPE.FP32 && contents.fp32_contents) {
      outputData[name] = new Float32Array(contents.fp32_contents);
    } else if (datatype === TRITON_DATATYPE.FP64 && contents.fp64_contents) {
      outputData[name] = new Float64Array(contents.fp64_contents);
    } else if ((datatype === TRITON_DATATYPE.INT16 || datatype === TRITON_DATATYPE.INT32) && contents.int_contents) {
      outputData[name] = new Int32Array(contents.int_contents);
    } else if (datatype === TRITON_DATATYPE.BYTES && contents.bytes_contents) {
      // Convert bytes to string
      outputData[name] = Buffer.from(contents.bytes_contents[0]).toString('utf-8');
    } else if (contents.bytes_contents && contents.bytes_contents.length > 0) {
      // Fallback for BYTES type
      outputData[name] = Buffer.from(contents.bytes_contents[0]).toString('utf-8');
    } else {
      outputData[name] = contents;
    }
  }

  return outputData;
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
 * Perform inference on Triton model (tries gRPC first, falls back to HTTP)
 */
export const inferTriton = async (
  modelName: string,
  inputs: Record<string, Float32Array | Int16Array | string[]>,
  outputs: string[]
): Promise<Record<string, any>> => {
  // Try gRPC first if connected
  if (isConnected && grpcClient) {
    try {
      logger.debug(`Using gRPC for ${modelName} inference`);
      return await inferGrpc(modelName, inputs, outputs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`gRPC inference failed: ${message}, falling back to HTTP`);
      isConnected = false;
    }
  }

  // Fallback to HTTP
  try {
    logger.debug(`Using HTTP for ${modelName} inference`);
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