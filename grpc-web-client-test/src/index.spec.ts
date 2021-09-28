import { createGrpcClientImpl } from "@pbkit/grpc-web-client";
import { createServiceClient } from "./gen/services/riiid/pingpong/PingPongService";
import "@pbkit/grpc-web-client/lib/node";

/**
 * if you run this test cases
 * you have to serve this server in your local computer
 * https://github.com/pbkit/pingpong-server
 */

describe("pingPongService", () => {
  it("pingPong", async () => {
    const pingPongService = createServiceClient(
      createGrpcClientImpl({
        host: "http://localhost:8080",
        metadata: {},
      }),
      { ignoreResMetadata: true }
    );
    const response = await pingPongService.pingPong({
      hello: "Ping",
    });

    expect(response).toEqual({
      world: "Pong",
    });
  });
});
