import fastify from "fastify";
import type {
  FastifyInstance,
  FastifyHttp2SecureOptions,
  FastifyHttp2Options,
  FastifyHttpsOptions,
  FastifyServerOptions,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import type { Method } from "@pbkit/runtime/rpc";
import { createEventBuffer } from "@pbkit/runtime/async/event-buffer";
import createMessageBuffer from "./messageBuffer";

export interface Metadata {
  request: FastifyRequest;
  reply: FastifyReply;
}
export interface Header {
  status: number;
}
export type Trailer = Record<string, string>;

interface CreateFrpcServerConfigBase {
  methods: AsyncGenerator<Method<Metadata, Header, Trailer>>;
  pathPrefix?: string;
}
interface CreateFrpcServerConfigWithFastifyInstance
  extends CreateFrpcServerConfigBase {
  fastifyInstance: FastifyInstance;
}
interface CreateFrpcServerConfigWithFastifyConfig
  extends CreateFrpcServerConfigBase {
  fastifyConfig: FastifyConfig;
}
type FastifyConfig =
  | FastifyHttp2SecureOptions<any>
  | FastifyHttp2Options<any>
  | FastifyHttpsOptions<any>
  | FastifyServerOptions;
export type CreateFrpcServerConfig =
  | CreateFrpcServerConfigWithFastifyInstance
  | CreateFrpcServerConfigWithFastifyConfig;
export async function createFrpcServer(config: CreateFrpcServerConfig) {
  const fastifyInstance =
    "fastifyInstance" in config
      ? config.fastifyInstance
      : "fastifyConfig" in config
      ? fastify(config.fastifyConfig)
      : fastify();
  fastifyInstance.addContentTypeParser(
    "application/frpc+proto",
    (_request, _payload, done) => done(null)
  );
  for await (const [methodDescriptor, methodImpl] of config.methods) {
    const {
      service: { serviceName },
      methodName,
      requestType,
      responseType,
    } = methodDescriptor;
    fastifyInstance.route({
      method: "POST",
      url: `/${config.pathPrefix ?? ""}${serviceName}/${methodName}`,
      handler: async (request, reply) => {
        const eventBuffer = createEventBuffer();
        const destroy = () => request.raw.destroy();
        request.raw.on(
          "data",
          createMessageBuffer((message) => {
            eventBuffer.push(requestType.deserializeBinary(message));
          }, noop)
        );
        request.raw.on("close", destroy);
        request.raw.on("error", destroy);
        const res = methodImpl(eventBuffer.drain(), { request, reply });
        const [messages, headerPromise, trailerPromise] = res;
        const header = await headerPromise;
        reply.raw.writeHead(header.status);
        for await (const message of messages) {
          const resBinary = responseType.serializeBinary(message);
          const resTypeAndLength = Buffer.alloc(5);
          resTypeAndLength.writeUInt8(0, 0);
          resTypeAndLength.writeUInt32LE(resBinary.length, 1);
          reply.raw.write(resTypeAndLength);
          reply.raw.write(resBinary);
        }
        for (const [key, value] of Object.entries(await trailerPromise)) {
          const resBinary = Buffer.from(`${key}:${value}`, "utf-8");
          const resTypeAndLength = Buffer.alloc(5);
          resTypeAndLength.writeUInt8(1, 0);
          resTypeAndLength.writeUInt32LE(resBinary.length, 1);
          reply.raw.write(resTypeAndLength);
          reply.raw.write(resBinary);
        }
        reply.raw.end();
      },
    });
  }
  return fastifyInstance;
}

const noop = () => {};
