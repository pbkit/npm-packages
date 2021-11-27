import { createGrpcWebClientImpl, Status } from "@pbkit/grpc-web-client";
import { createServiceClient } from "./gen/services/riiid/pingpong/PingPongService";
import "@pbkit/grpc-web-client/lib/node";

/**
 * if you run this test cases
 * you have to serve this server in your local computer
 * https://github.com/pbkit/pingpong-server
 */

const grpcServer = createGrpcWebClientImpl({
  host: "http://localhost:8080",
});

describe("PingPongService", () => {
  it("ping pong", async () => {
    const { pingPong } = createServiceClient(grpcServer);
    const response = await pingPong({ hello: "Ping" });
    expect(response).toEqual({ world: "Pong" });
  });
  it("trailer", async () => {
    const { pingPong } = createServiceClient(grpcServer, {
      responseOnly: false,
    });
    const [response, _header, trailer] = await pingPong({ hello: "Ping" });
    expect(response).toEqual({ world: "Pong" });
    expect(await trailer).toMatchObject({ status: Status.OK });
  });
});
