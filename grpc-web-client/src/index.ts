import type { RpcClientImpl } from "pbkit/core/runtime/rpc";
import { grpc } from "@improbable-eng/grpc-web";

type Metadata = Record<string, string>;

export interface ConfigMetadata {
  [key: string]:
    | string
    | (() => string | undefined)
    | (() => Promise<string | undefined>);
}
export interface CreateGrpcClientImplConfig {
  host: string;
  metadata: ConfigMetadata;
}

type Response = any;

export function createGrpcClientImpl(
  config: CreateGrpcClientImplConfig
): RpcClientImpl<Metadata, Metadata> {
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
      const metadataPromise: Promise<Metadata> = new Promise((resolve) => {
        let responseHeaders: grpc.Metadata | undefined = undefined;
        grpcClient.onHeaders((headers) => (responseHeaders = headers));
        grpcClient.onEnd((status, statusMessage, trailers) => {
          resolve({
            ...grpcMetadataToRecord(responseHeaders),
            ...grpcMetadataToRecord(trailers),
            status: status.toString(),
            statusMessage,
          });
        });
      });
      (async () => {
        const newMetadata = metadata ?? {};
        for (const [key, value] of Object.entries(config.metadata)) {
          if (key in newMetadata) continue;
          const v = typeof value === "string" ? value : await value();
          if (v) newMetadata[key] = v;
        }
        grpcClient.start(newMetadata);
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
      return [result, metadataPromise];
    };
  };
}

function grpcMetadataToRecord(value?: grpc.Metadata): Record<string, string> {
  const result: Record<string, string> = {};
  value?.forEach((key, values) => (result[key] = values[values.length - 1]));
  return result;
}
