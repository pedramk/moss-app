const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  startCapture: () => ipcRenderer.send("start-capture"),
  stopCapture: () => ipcRenderer.send("stop-capture"),
  onGrpcEvent: (callback) =>
    ipcRenderer.on("grpc-event", (event, value) => callback(value)),
  onClearEvents: (callback) => ipcRenderer.on('clear-events', callback),
});
