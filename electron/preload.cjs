const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("studio", {
  load: () => ipcRenderer.invoke("load"),
  saveDraft: (d) => ipcRenderer.invoke("saveDraft", d),
  deleteDraft: (id) => ipcRenderer.invoke("deleteDraft", id),
  saveSite: (s) => ipcRenderer.invoke("saveSite", s),
  testSite: (id) => ipcRenderer.invoke("testSite", id),
  saveAI: (s) => ipcRenderer.invoke("saveAI", s),
  generate: (d) => ipcRenderer.invoke("generate", d),
  approve: (id) => ipcRenderer.invoke("approve", id),
  publish: (id) => ipcRenderer.invoke("publish", id),
  savePrompt: (p) => ipcRenderer.invoke("savePrompt", p),
  reconcile: (id, url) => ipcRenderer.invoke("reconcile", { id, url }),
});
