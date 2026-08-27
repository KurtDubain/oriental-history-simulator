export {};

declare global {
  const __APP_VERSION__: string;
  const __APP_BUILD_ID__: string;

  interface Window {
    render_game_to_text?: () => string;
    advanceTime?: (milliseconds: number) => void;
  }
}
