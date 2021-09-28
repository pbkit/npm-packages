import type { RpcClientImpl } from "pbkit/core/runtime/rpc";
import { grpc } from "@improbable-eng/grpc-web";

type Metadata = grpc.Metadata;

export interface ConfigMetadata {
  [key: string]: string | (() => string) | (() => Promise<string>);
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
        let responseHeaders: Metadata | undefined = undefined;
        grpcClient.onHeaders(
          (headers: Metadata) => (responseHeaders = headers)
        );
        grpcClient.onEnd((status, statusMessage, trailers) => {
          const resultMetadata = mergeMetadata(responseHeaders, trailers);
          resultMetadata.set("status", status.toString());
          resultMetadata.set("statusMessage", statusMessage);
          resolve(resultMetadata);
        });
      });
      (async () => {
        const newMetadata = new grpc.Metadata(metadata);
        for (const [key, value] of Object.entries(config.metadata)) {
          if (newMetadata.has(key)) continue;
          if (typeof value === "string") {
            newMetadata.append(key, value);
          } else {
            newMetadata.append(key, await value());
          }
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
            return new Promise<Response>(
              (_resolve) => (resolveResponse = _resolve)
            );
          }
        },
        return: (value: Response) => Promise.resolve({ value, done: true }),
        throw: (error: any) => Promise.reject(error),
      };
      return [result, metadataPromise];
    };
  };
}

function mergeMetadata(a?: Metadata, b?: Metadata) {
  if (!a && !b) return new grpc.Metadata();
  if (!a) return b!;
  if (!b) return a!;
  const newMetadata = new grpc.Metadata(a);
  b.forEach((key, values) => newMetadata.append(key, values));
  return newMetadata;
}
