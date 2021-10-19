import BufferList from "bl/BufferList";

export interface CreateMessageBuffer {
  (
    onMessage: (message: Uint8Array) => void,
    onTrailer: (key: string, value: string) => void,
  ): (chunk: Uint8Array) => void;
}
export const createMessageBuffer: CreateMessageBuffer = (
  onMessage,
  onTrailer,
) => {
  const bl = new BufferList();
  return (chunk) => {
    bl.append(Buffer.from(chunk.buffer));
    while (bl.length >= 5) {
      const type = bl.readUInt8(0);
      const length = bl.readUInt32LE(1);
      if (bl.length < length + 5) return;
      bl.consume(5); // consume type and length
      if (type === 0) {
        onMessage(bl.slice(0, length));
      } else if (type === 1) {
        const trailer = bl.slice(0, length).toString("utf-8");
        const [key, ...value] = trailer.split(":");
        onTrailer(key, value.join(":"));
      }
      bl.consume(length); // consume payload
    }
  };
};
export default createMessageBuffer;
