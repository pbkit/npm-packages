import type { RpcClientImpl } from "@pbkit/runtime/rpc";
import { grpc } from "@improbable-eng/grpc-web";

export type Metadata = Record<string, string>;
export type Header = Metadata;
export type Trailer = Metadata & { status: string; statusMessage: string };

export interface ConfigMetadata {
  [key: string]:
    | string
    | (() => string | undefined)
    | (() => Promise<string | undefined>);
}
export interface CreateGrpcClientImplConfig {
  host: string;
  metadata?: ConfigMetadata;
}

type Response = any;

export function createGrpcClientImpl(
  config: CreateGrpcClientImplConfig,
): RpcClientImpl<Metadata, Header, Trailer> {
  return (methodDescriptor) => {
    return (req, metadata) => {
      const grpcClient = grpc.client<any, any, any>(methodDescriptor, {
        host: config.host,
        debug: false,
      });
      const responseQueue: Response[] = [];
      let resolveResponse: ((v: Response) => void) | undefined = undefined;
      grpcClient.onMessage((res: Response) => {
        if (resolveResponse) {
          resolveResponse({ value: res, done: false });
          resolveResponse = undefined;
        } else {
          responseQueue.push(res);
        }
      });
      const headerPromise: Promise<Header> = new Promise((resolve) => {
        grpcClient.onHeaders((header) => resolve(grpcMetadataToRecord(header)));
      });
      const trailerPromise: Promise<Trailer> = new Promise((resolve) => {
        grpcClient.onEnd(async (status, statusMessage, trailer) => {
          resolve({
            ...grpcMetadataToRecord(trailer),
            status: status.toString(),
            statusMessage,
          });
        });
      });
      (async () => {
        const m = { ...metadata };
        if (config.metadata) {
          for (const [key, value] of Object.entries(config.metadata)) {
            if (key in m) continue;
            const v = typeof value === "string" ? value : await value();
            if (v) m[key] = v;
          }
        }
        grpcClient.start(m);
        for await (const value of req) {
          grpcClient.send({
            serializeBinary: () =>
              methodDescriptor.requestType.serializeBinary(value),
          });
        }
        grpcClient.finishSend();
      })();
      const result = {
        [Symbol.asyncIterator]: () => result,
        next: function () {
          if (responseQueue.length > 0) {
            return Promise.resolve({
              value: responseQueue.shift(),
              done: false,
            });
          } else {
            return new Promise<Response>((r) => (resolveResponse = r));
          }
        },
        return: (value: Response) => Promise.resolve({ value, done: true }),
        throw: (error: any) => Promise.reject(error),
      };
      return [result, headerPromise, trailerPromise];
    };
  };
}

function grpcMetadataToRecord(value?: grpc.Metadata): Record<string, string> {
  const result: Record<string, string> = {};
  value?.forEach((key, values) => (result[key] = values[values.length - 1]));
  return result;
}
