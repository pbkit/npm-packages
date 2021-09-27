import type { RpcClientImpl } from "pbkit/core/runtime/rpc";
import { grpc } from "@improbable-eng/grpc-web";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";

if (typeof window === "undefined") {
  grpc.setDefaultTransport(NodeHttpTransport());
}

export interface CreateGrpcClientImplConfig {
  host: string;
  metadata: grpc.Metadata;
}

type RequestMetadata = any;
type ResponseMetadata = any;
type Response = any;

export function createGrpcClientImpl(
  config: CreateGrpcClientImplConfig
): RpcClientImpl<RequestMetadata, ResponseMetadata> {
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
          resolveResponse({
            value: res,
            done: false,
          });
          resolveResponse = undefined;
        } else {
          responseQueue.push(res);
        }
      });

      const metadataPromise: Promise<ResponseMetadata> = new Promise(
        (resolve) => {
          let responseHeaders: grpc.Metadata | undefined = undefined;

          grpcClient.onHeaders((headers: grpc.Metadata) => {
            responseHeaders = headers;
          });

          grpcClient.onEnd((status, statusMessage, trailers) => {
            resolve({
              status: status,
              statusMessage: statusMessage,
              headers: responseHeaders ? responseHeaders : {},
              trailers: trailers,
            });
          });
        }
      );

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
        return: (value: Response) => {
          return Promise.resolve({ value, done: true });
        },
        throw: (error: any) => Promise.reject(error),
      };

      grpcClient.start(config.metadata);

      asyncForEach(req, (req) => {
        grpcClient.send({
          serializeBinary: () =>
            methodDescriptor.requestType.serializeBinary(req),
        });
      }).then(() => {
        grpcClient.finishSend();
      });

      return [result, metadataPromise];
    };
  };
}

async function asyncForEach<T>(
  asyncGenerator: AsyncGenerator<T>,
  cb: (value: T) => void
) {
  for await (const value of asyncGenerator) cb(value);
}
