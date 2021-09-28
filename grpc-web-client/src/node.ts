import { grpc } from "@improbable-eng/grpc-web";
import { NodeHttpTransport } from "@improbable-eng/grpc-web-node-http-transport";

if (typeof window === "undefined") {
  grpc.setDefaultTransport(NodeHttpTransport());
}
