const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const EventEmitter = require("events");
const path = require("path");

const emitter = new EventEmitter();

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
let client;
let call;
let isConnected = false;

// Function to establish connection with retry
function connectWithRetry(maxRetries = 20, delay = 1000) {
  let retries = 0;
  
  function attemptConnection() {
    if (retries === 0) {
      console.log("Attempting to connect to agent...");
    }
    
    client = new captureProto.CaptureService(
      "localhost:50051",
      grpc.credentials.createInsecure()
    );
    
    // Test connection with a simple call
    client.waitForReady(Date.now() + 5000, (err) => {
      if (err) {
        if (retries < maxRetries) {
          retries++;
          if (retries <= 3) {
            console.log(`gRPC connection attempt ${retries}/${maxRetries} failed, retrying in ${delay}ms...`);
          } else if (retries === 4) {
            console.log("Still trying to connect to agent... (further attempts will be silent)");
          }
          setTimeout(attemptConnection, delay);
        } else {
          console.error("gRPC connection failed after all retries:", err.message);
        }
      } else {
        console.log("gRPC connection established successfully");
        isConnected = true;
        
        // Start streaming events
        startEventStream();
      }
    });
  }
  
  // Wait a bit before starting connection attempts to give agent time to start
  setTimeout(attemptConnection, 2000);
}

// Function to start event streaming
function startEventStream() {
  if (!client || !isConnected) {
    return;
  }
  
  call = client.StreamEvents({}, {});
  
  call.on("data", (event) => {
    emitter.emit("event", event);
  });
  
  call.on("end", () => {
    console.log("gRPC stream ended");
    // Try to reconnect if the stream ends unexpectedly
    if (isConnected) {
      isConnected = false;
      setTimeout(() => connectWithRetry(), 1000);
    }
  });
  
  call.on("error", (err) => {
    console.error("gRPC stream error:", err);
    if (isConnected) {
      isConnected = false;
      setTimeout(() => connectWithRetry(), 1000);
    }
  });
}

// Expose client methods
emitter.startCapture = () => {
  if (!client || !isConnected) {
    console.error("gRPC client not connected");
    return;
  }
  client.Start({}, (err, response) => {
    if (err) {
      console.error("Failed to start capturing:", err);
    } else {
      console.log("Agent capturing started:", response.message);
    }
  });
};

emitter.stopCapture = () => {
  if (!client || !isConnected) {
    console.error("gRPC client not connected");
    return;
  }
  client.Stop({}, (err, response) => {
    if (err) {
      console.error("Failed to stop capturing:", err);
    } else {
      console.log("Agent capturing stopped:", response.message);
    }
  });
};

module.exports = emitter;

// Start connection attempts
connectWithRetry();
