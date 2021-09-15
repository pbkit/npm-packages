import type { RpcImpl } from "pbkit/core/runtime/rpc";
import { grpc } from "@improbable-eng/grpc-web";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";

if (typeof window === "undefined") {
  grpc.setDefaultTransport(NodeHttpTransport());
}

export interface CreateGrpcClientImplConfig {
  host: string;
  metadata: grpc.Metadata;
}

export function createGrpcClientImpl(
  config: CreateGrpcClientImplConfig
): RpcImpl<grpc.Metadata> {
  return (servicePath, methodName, utilsFns) => {
    return (req, metadata) => {
      const grpcClient = grpc.client<any, any, any>(
        {
          service: {
            serviceName: servicePath,
          },
          methodName: methodName,
          requestStream: false,
          responseStream: false,
          responseType: {
            deserializeBinary: utilsFns.decodeResponseBinary,
          },
        },
        {
          host: config.host,
          debug: false,
        }
      );

      type Response = any;
      // let responseHeaders: grpc.Metadata | null = null;
      // let responseMessage: Response | null = null;

      // grpcClient.onHeaders((headers: grpc.Metadata) => {
      //   responseHeaders = headers;
      // });

      const responseQueue: Response[] = [];

      let resolve: ((v: Response) => void) | undefined = undefined;

      grpcClient.onMessage((res: Response) => {
        console.log("onMessage", res);
        if (resolve) {
          resolve({
            value: res,
            done: false,
          });
          resolve = undefined;
        } else {
          responseQueue.push(res);
        }
      });

      // grpcClient.onEnd((status, statusMessage, trailers) => {
      // props.onEnd({
      //   status: status,
      //   statusMessage: statusMessage,
      //   headers: responseHeaders ? responseHeaders : {},
      //   message: responseMessage,
      //   trailers: trailers,
      // });
      // });

      const result = {
        [Symbol.asyncIterator]: () => result,
        next: function () {
          if (responseQueue.length > 0) {
            return Promise.resolve({
              value: responseQueue.shift(),
              done: false,
            });
          } else {
            return new Promise<Response>((_resolve) => (resolve = _resolve));
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
          serializeBinary: () => utilsFns.encodeRequestBinary(req),
        });
      }).then(() => {
        grpcClient.finishSend();
      });

      // return {
      //   close: () => {
      //     grpcClient.close();
      //   }

      return result;
    };
  };
}

async function asyncForEach<T>(
  asyncGenerator: AsyncGenerator<T>,
  cb: (value: T) => void
) {
  for await (const value of asyncGenerator) cb(value);
}
