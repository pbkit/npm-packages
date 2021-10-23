import type { Readable } from "stream";
import BufferList = require("bl/BufferList");
import type { RpcClientImpl } from "@pbkit/runtime/rpc";
import { first } from "@pbkit/runtime/async/async-generator";
import { createEventBuffer } from "@pbkit/runtime/async/event-buffer";
import { defer } from "@pbkit/runtime/async/observer";
import createMessageBuffer from "./messageBuffer";

export type Metadata = Record<string, string>;
export type Header = Metadata;
export type Trailer = Metadata;

export interface ConfigMetadata {
  [key: string]:
    | string
    | (() => string | undefined)
    | (() => Promise<string | undefined>);
}
export interface CreateFrpcClientImplConfig {
  host: string;
  metadata?: ConfigMetadata;
  fetch?: typeof fetch;
}

type Response = any;

export function createFrpcClientImpl(
  config: CreateFrpcClientImplConfig,
): RpcClientImpl<Metadata, Header, Trailer> {
  return (methodDescriptor) => {
    return (req, metadata) => {
      const headerPromise = defer<Header>();
      const trailerPromise = defer<Trailer>();
      let drainEnded = false;
      const eventBuffer = createEventBuffer<Response>({
        onDrainEnd() {
          drainEnded = true;
          headerPromise.reject();
          trailerPromise.reject();
        },
      });
      const trailer: Trailer = {};
      const collect = createMessageBuffer(
        methodDescriptor.responseType.deserializeBinary,
        eventBuffer.push,
        (key, value) => (trailer[key] = value),
      );
      prepareHeader(metadata, config.metadata).then(async (headers) => {
        const {
          serializeBinary: serializeRequestBinary,
        } = methodDescriptor.requestType;
        // TODO: streaming request
        const reqBinary = serializeRequestBinary(await first(req));
        const reqTypeAndLength = Buffer.alloc(5);
        reqTypeAndLength.writeUInt8(0, 0);
        reqTypeAndLength.writeUInt32LE(reqBinary.length, 1);
        const reqMessage = new BufferList([
          reqTypeAndLength,
          Buffer.from(reqBinary.buffer),
        ]);
        const body = reqMessage.slice();
        const { service: { serviceName }, methodName } = methodDescriptor;
        const reqUrl = [config.host, serviceName, methodName].join("/");
        const res = await (config.fetch ?? fetch)(reqUrl, {
          method: "POST",
          cache: "no-cache",
          headers,
          body,
        });
        headerPromise.resolve(headersToRecord(res.headers));
        const resBody = res.body!;
        if (!resBody.getReader) { // node-fetch
          const reader = resBody as unknown as Readable;
          reader.on("data", collect);
          reader.on("close", () => {
            trailerPromise.resolve(trailer);
            eventBuffer.finish();
          });
        } else {
          const reader = resBody.getReader();
          while (true) {
            console.log({ drainEnded });
            if (drainEnded) {
              reader.cancel();
              break;
            }
            const { done, value } = await reader.read();
            if (value) collect(value);
            if (done) break;
          }
          trailerPromise.resolve(trailer);
          eventBuffer.finish();
        }
      });
      return [eventBuffer.drain(), headerPromise, trailerPromise];
    };
  };
}

async function prepareHeader(
  metadata?: Record<string, string>,
  configMetadata?: ConfigMetadata,
): Promise<Record<string, string>> {
  const header: Record<string, string> = {
    "content-type": "application/frpc+proto",
    ...metadata,
  };
  if (configMetadata) {
    for (const [key, value] of Object.entries(configMetadata)) {
      if (key in header) continue;
      const v = typeof value === "string" ? value : await value();
      if (v) header[key] = v;
    }
  }
  return header;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => (result[key] = value));
  return result;
}
