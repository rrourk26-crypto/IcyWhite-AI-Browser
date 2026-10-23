// Preload for the screen/window picker dialog only. It can do three things: receive the list, choose one, cancel.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("oasisPicker", {
  onSources: (cb) => ipcRenderer.on("picker-sources", (_e, list) => cb(list)),
  choose: (id) => ipcRenderer.send("picker-choose", String(id)),
  cancel: () => ipcRenderer.send("picker-cancel"),
  refresh: () => ipcRenderer.send("picker-refresh")
});
