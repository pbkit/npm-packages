import { grpc } from "@improbable-eng/grpc-web";
import { createGrpcClientImpl } from ".";
import { createServiceClient } from "./gen/services/riiid/pingpong/PingPongService";
import "./node";

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
        metadata: new grpc.Metadata(),
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
