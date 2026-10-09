import { createContext, useContext } from 'react';
import type { DustApi } from '../../../src/shared/ipc';

export const ApiContext = createContext<DustApi | null>(null);

/** The backend. Tests provide a fake through `ApiContext`; nothing else reads `window.dust`. */
export function useApi(): DustApi {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('useApi needs an ApiContext provider');
  return api;
}

/** The one place the preload bridge is read. */
export function getWindowApi(): DustApi {
  return window.dust;
}
