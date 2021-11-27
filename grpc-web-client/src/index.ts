import type { RpcClientImpl } from "@pbkit/runtime/rpc";
import { createEventBuffer } from "@pbkit/runtime/async/event-buffer";
import { defer } from "@pbkit/runtime/async/observer";
import { grpc } from "@improbable-eng/grpc-web";

export type Metadata = Record<string, string>;
export type Header = Metadata;
export type Trailer = Metadata & { status: Status; statusMessage: string };

export interface ConfigMetadata {
  [key: string]:
    | string
    | (() => string | undefined)
    | (() => Promise<string | undefined>);
}
export interface CreateGrpcWebClientImplConfig {
  host: string;
  metadata?: ConfigMetadata;
}

export enum Status {
  OK = "0",
  CANCELLED = "1",
  UNKNOWN = "2",
  INVALID_ARGUMENT = "3",
  DEADLINE_EXCEEDED = "4",
  NOT_FOUND = "5",
  ALREADY_EXISTS = "6",
  PERMISSION_DENIED = "7",
  RESOURCE_EXHAUSTED = "8",
  FAILED_PRECONDITION = "9",
  ABORTED = "10",
  OUT_OF_RANGE = "11",
  UNIMPLEMENTED = "12",
  INTERNAL = "13",
  UNAVAILABLE = "14",
  DATA_LOSS = "15",
  UNAUTHENTICATED = "16",
}

type Response = any;

export function createGrpcWebClientImpl(
  config: CreateGrpcWebClientImplConfig
): RpcClientImpl<Metadata, Header, Trailer> {
  return (methodDescriptor) => {
    const isServerStreamOrBidi = methodDescriptor.responseStream;
    const trailerWhenDrainEnded: Trailer = Object.freeze({
      status: Status.CANCELLED,
      statusMessage: "Drain ended",
    });
    return (req, metadata) => {
      const headerPromise = defer<Header>();
      const trailerPromise = defer<Trailer>();
      const eventBuffer = createEventBuffer<Response>({
        onDrainEnd: isServerStreamOrBidi
          ? () => {
              grpcClient.close();
              headerPromise.reject("Drain ended before receive header");
              trailerPromise.resolve(trailerWhenDrainEnded);
            }
          : undefined,
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
          status: status.toString() as Status,
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
