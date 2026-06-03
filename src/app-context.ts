import { createContext, useContext } from 'react';
import { getTheme, type ColorTheme, type Settings } from './db';

interface AppContextType {
  theme: ColorTheme;
  amountVisible: boolean;
  setAmountVisible: (v: boolean) => void;
  settings: Settings | null;
  reloadSettings: () => void;
}

export const AppContext = createContext<AppContextType>({
  theme: getTheme('emerald-rose'),
  amountVisible: true,
  setAmountVisible: () => {},
  settings: null,
  reloadSettings: () => {},
});

export const useAppContext = () => useContext(AppContext);
