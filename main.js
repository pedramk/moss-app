const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const { Level } = require("level");
const archiver = require("archiver");
const fs = require("fs");

let agentProcess;
let db;
let isCapturing = false;
const dbPath = path.join(app.getPath("userData"), "capture-db");

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile("index.html");
}

// Forward events from grpc-client.js to renderer
function setupGrpcEvents() {
  const grpcClient = require("./grpc-client");
  
  // Store reference for later use
  global.grpcClient = grpcClient;
  grpcClient.on("event", (event) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (isCapturing) {
      const key = `${event.timestamp}-${event.name}-${Math.random()}`;
      db.put(key, JSON.stringify(event), (err) => {
        if (err) console.error("Failed to write to LevelDB", err);
      });
      if (win) {
        win.webContents.send("grpc-event", event);
      }
    } else {
      // If not capturing, still send to renderer but maybe differently?
      // Or just don't send at all if the table should be blank.
    }
  });
}

ipcMain.on("start-capture", async () => {
  try {
    isCapturing = true;
    // Clear old db
    if (db) {
      await db.close();
    }
    fs.rmSync(dbPath, { recursive: true, force: true });
    db = new Level(dbPath);
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("clear-events");
    });
    
    // Tell the agent to start capturing
    if (global.grpcClient) {
      global.grpcClient.startCapture();
    }
  } catch (error) {
    console.error("Error in start-capture:", error);
  }
});

ipcMain.on("stop-capture", async () => {
  try {
    isCapturing = false;
    
    // Tell the agent to stop capturing
    if (global.grpcClient) {
      global.grpcClient.stopCapture();
    }

    const replaysDir = path.join(__dirname, "replays");
    if (!fs.existsSync(replaysDir)) {
      fs.mkdirSync(replaysDir);
    }

    const filePath = path.join(replaysDir, `capture-${Date.now()}.zip`);

    if (db) {
      const values = await db.values().all();
      const events = values.map((v) => JSON.parse(v));

      await db.close();

      const output = fs.createWriteStream(filePath);
      const archive = archiver("zip");

      output.on("close", () => {
        console.log(archive.pointer() + " total bytes");
        fs.rmSync(dbPath, { recursive: true, force: true });
      });

      archive.on("error", (err) => {
        console.error("Archive error:", err);
      });

      archive.pipe(output);
      archive.append(JSON.stringify(events, null, 2), { name: "events.json" });
      await archive.finalize();
    }
  } catch (err) {
    console.error("Failed during stop-capture process:", err);
  }
});

app.whenReady().then(() => {
  const agentPath = path.join(__dirname, "bin", "agent.exe");
  agentProcess = spawn(agentPath, [], { windowsHide: true });

  agentProcess.stdout.on("data", (data) => {
    console.log(`[Agent]: ${data}`);
  });

  agentProcess.stderr.on("data", (data) => {
    console.error(`[Agent ERROR]: ${data}`);
  });

  agentProcess.on("error", (err) => {
    console.error("Failed to start agent process:", err);
  });

  createWindow();
  setupGrpcEvents();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", async () => {
  try {
    // Gracefully close gRPC connection
    if (global.grpcClient && global.grpcClient.close) {
      global.grpcClient.close();
    }
    
    // Close database if open
    if (db) {
      await db.close();
    }
    
    // Kill agent process
    if (agentProcess) {
      agentProcess.kill();
    }
  } catch (error) {
    console.error("Error during app cleanup:", error);
  }
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
