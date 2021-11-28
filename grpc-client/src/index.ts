import type { RpcClientImpl } from "@pbkit/runtime/rpc";
import { createEventBuffer } from "@pbkit/runtime/async/event-buffer";
import { defer } from "@pbkit/runtime/async/observer";
import * as grpc from "@grpc/grpc-js";

export type Metadata = Record<string, string>;
export type Header = Metadata;
export type Trailer = Metadata & { status: Status; statusMessage: string };

export interface ConfigMetadata {
  [key: string]:
    | string
    | (() => string | undefined)
    | (() => Promise<string | undefined>);
}
export interface CreateGrpcClientImplConfig {
  grpcJsClient: grpc.Client;
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

export function createGrpcJsClient(host: string): grpc.Client {
  return new grpc.Client(host, grpc.credentials.createInsecure());
}

export function createGrpcClientImpl(
  config: CreateGrpcClientImplConfig
): RpcClientImpl<Metadata, Header, Trailer> {
  const grpcJsClient = config.grpcJsClient;
  return (methodDescriptor) => {
    const {
      responseStream,
      requestType,
      responseType,
      service: { serviceName },
      methodName,
    } = methodDescriptor;
    const path = `/${serviceName}/${methodName}`;
    const isServerStreamOrBidi = responseStream;
    const trailerWhenDrainEnded: Trailer = Object.freeze({
      status: Status.CANCELLED,
      statusMessage: "Drain ended",
    });
    return (req, metadata) => {
      const headerPromise = defer<Header>();
      const trailerPromise = defer<Trailer>();
      let call: grpc.ClientDuplexStream<any, any>;
      const eventBuffer = createEventBuffer<Response>({
        onDrainEnd: isServerStreamOrBidi
          ? () => {
              call.cancel();
              call.end();
              headerPromise.reject("Drain ended before receive header");
              trailerPromise.resolve(trailerWhenDrainEnded);
            }
          : undefined,
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
        call = grpcJsClient.makeBidiStreamRequest(
          path,
          (req) => Buffer.from(requestType.serializeBinary(req)),
          responseType.deserializeBinary
        );
        call.on("metadata", (header) => {
          headerPromise.resolve(grpcMetadataToRecord(header));
        });
        call.on("data", eventBuffer.push);
        call.on("status", ({ code, details, metadata }) => {
          trailerPromise.resolve({
            ...grpcMetadataToRecord(metadata),
            status: String(code) as Status,
            statusMessage: details,
          });
        });
        call.on("end", eventBuffer.finish);
        for await (const value of req) {
          call.write(value);
        }
        call.end();
      })();
      return [eventBuffer.drain(), headerPromise, trailerPromise];
    };
  };
}

function grpcMetadataToRecord(value?: grpc.Metadata): Record<string, string> {
  const result: Record<string, string> = {};
  const map = value?.getMap() ?? {};
  for (const key in map) {
    const value = map[key];
    result[key] = value instanceof Buffer ? value.toString("utf8") : value;
  }
  return result;
}
