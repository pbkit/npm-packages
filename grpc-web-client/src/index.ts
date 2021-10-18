import type { RpcClientImpl } from "@pbkit/runtime/rpc";
import { createEventBuffer } from "@pbkit/runtime/async/event-buffer";
import { defer } from "@pbkit/runtime/async/observer";
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
      const headerPromise = defer<Header>();
      const trailerPromise = defer<Trailer>();
      const eventBuffer = createEventBuffer<Response>({
        onDrainEnd() {
          grpcClient.close();
          headerPromise.reject();
          trailerPromise.reject();
        },
      });
      const grpcClient = grpc.client<any, any, any>(methodDescriptor, {
        host: config.host,
        debug: false,
      });
      grpcClient.onHeaders((header) => {
        headerPromise.resolve(grpcMetadataToRecord(header));
      });
      grpcClient.onMessage(eventBuffer.push);
      grpcClient.onEnd((status, statusMessage, trailer) => {
        trailerPromise.resolve({
          ...grpcMetadataToRecord(trailer),
          status: status.toString(),
          statusMessage,
        });
        eventBuffer.finish();
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
      return [eventBuffer.drain(), headerPromise, trailerPromise];
    };
  };
}

function grpcMetadataToRecord(value?: grpc.Metadata): Record<string, string> {
  const result: Record<string, string> = {};
  value?.forEach((key, values) => (result[key] = values[values.length - 1]));
  return result;
}
