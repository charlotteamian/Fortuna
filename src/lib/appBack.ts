/**
 * Bridge between the Android back gesture and the SPA's navigation state.
 *
 * The app navigates through React state (tabs, account detail, modals) rather than the
 * history API, so the native back button needs an explicit hook to walk back one level
 * instead of closing the Activity. A handler returns true when it consumed the gesture
 * (it navigated back somewhere), and false when the app is at its root and the Activity
 * should finish.
 */
type BackHandler = () => boolean;

let backHandler: BackHandler | null = null;

export function setAppBackHandler(handler: BackHandler | null): void {
  backHandler = handler;
}

export function installAppBackBridge(): void {
  const target = window as unknown as { __fortunaBack?: { goBack: BackHandler } };
  target.__fortunaBack = {
    goBack: () => (backHandler ? backHandler() : false),
  };
}
