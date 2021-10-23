import fetch from "node-fetch";
import { first } from "pbkit/core/runtime/async/async-generator";
import { createEventBuffer } from "pbkit/core/runtime/async/event-buffer";
import {
  getMethodImpl,
  Method,
  MethodDescriptor,
  MethodImplHandler,
} from "pbkit/core/runtime/rpc";
import {
  createFrpcServer,
  Header,
  Metadata,
  Trailer,
} from "@pbkit/frpc-server";
import { createFrpcClientImpl } from "@pbkit/frpc-client";
import {
  createServiceClient,
  methodDescriptors,
} from "./gen/services/riiid/pingpong/PingPongService";

function createFrpcServerImplBuilder() {
  return createServerImplBuilder<Metadata, Header, Trailer>();
}
function createServerImplBuilder<TMetadata, THeader, TTrailer>() {
  const buffer = createEventBuffer<Method<TMetadata, THeader, TTrailer>>();
  return {
    register<TReq, TRes>(
      methodDescriptor: MethodDescriptor<TReq, TRes>,
      handler: MethodImplHandler<TReq, TRes, TMetadata, THeader, TTrailer>,
    ) {
      buffer.push([methodDescriptor, getMethodImpl(handler)]);
    },
    finish: buffer.finish,
    drain: buffer.drain,
  };
}

describe("PingPongService", () => {
  it("ping pong", async () => {
    const serverImplBuilder = createFrpcServerImplBuilder();
    const { pingPong } = methodDescriptors;
    serverImplBuilder.register(pingPong, async (req, res) => {
      const reqMessage = await first(req.messages);
      expect(reqMessage).toEqual({ hello: "hello" });
      res.header({ status: 200 });
      res.send({ world: "world" });
      res.end({});
    });
    serverImplBuilder.finish();

    const port = 3000;

    const server = await createFrpcServer({
      methods: serverImplBuilder.drain(),
    });
    await server.listen(port);

    const clientImpl = createFrpcClientImpl({
      host: `http://localhost:${port}`,
      fetch: fetch as any,
    });
    const client = createServiceClient(clientImpl, { responseOnly: true });
    const result = await client.pingPong({ hello: "hello" });
    expect(result).toEqual({ world: "world" });

    await server.close();
  });
});
