import { contextBridge, ipcRenderer } from 'electron';
import type { CapturePayload, CaptureSelection, HistoryEntry, PublicSettings, ResultState, SettingsUpdate, TestTranslationResult } from '../shared/types';

const api = {
  capture: {
    getPayload: (): Promise<CapturePayload> => ipcRenderer.invoke('capture:get-payload'),
    complete: (selection: CaptureSelection): Promise<void> => ipcRenderer.invoke('capture:complete', selection),
    cancel: (): Promise<void> => ipcRenderer.invoke('capture:cancel')
  },
  result: {
    get: (id: string): Promise<ResultState | null> => ipcRenderer.invoke('result:get', id),
    retry: (id: string): Promise<void> => ipcRenderer.invoke('result:retry', id),
    swap: (id: string): Promise<void> => ipcRenderer.invoke('result:swap', id),
    copy: (text: string): Promise<void> => ipcRenderer.invoke('result:copy', text),
    pin: (id: string, pinned: boolean): Promise<void> => ipcRenderer.invoke('result:pin', id, pinned),
    resize: (id: string, width: number, height: number): Promise<void> => ipcRenderer.invoke('result:resize', id, width, height),
    close: (id: string): Promise<void> => ipcRenderer.invoke('result:close', id),
    onUpdate: (callback: (state: ResultState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ResultState) => callback(state);
      ipcRenderer.on('result:update', listener);
      return () => { ipcRenderer.removeListener('result:update', listener); };
    }
  },
  settings: {
    get: (): Promise<PublicSettings> => ipcRenderer.invoke('settings:get'),
    save: (update: SettingsUpdate): Promise<PublicSettings> => ipcRenderer.invoke('settings:save', update),
    test: (update: SettingsUpdate): Promise<TestTranslationResult> => ipcRenderer.invoke('settings:test', update)
  },
  history: {
    list: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:list'),
    delete: (id: string): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:delete', id),
    clear: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:clear'),
    onChanged: (callback: (history: HistoryEntry[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, history: HistoryEntry[]) => callback(history);
      ipcRenderer.on('history:changed', listener);
      return () => { ipcRenderer.removeListener('history:changed', listener); };
    }
  },
  app: {
    startCapture: (): Promise<void> => ipcRenderer.invoke('app:start-capture'),
    openSettings: (): Promise<void> => ipcRenderer.invoke('app:open-settings'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:open-external', url),
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close')
  }
};

contextBridge.exposeInMainWorld('ninTranslate', api);
export type NinTranslateApi = typeof api;
