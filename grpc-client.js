const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const EventEmitter = require("events");
const path = require("path");

const emitter = new EventEmitter();
module.exports = emitter;

const PROTO_PATH = path.join(__dirname, "proto/capture.proto");

// Load proto
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const captureProto = grpc.loadPackageDefinition(packageDefinition).capture;
const client = new captureProto.CaptureService(
  "localhost:50051",
  grpc.credentials.createInsecure()
);

// Start streaming events
const call = client.StreamEvents({}, {});

call.on("data", (event) => {
  emitter.emit("event", event);
});

call.on("end", () => {
  // Stream ended
});

call.on("error", (err) => {
  console.error("gRPC stream error:", err);
});
