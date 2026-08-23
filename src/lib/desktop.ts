export type DesktopCommand =
  'new-flow' | 'save' | 'import' | 'undo' | 'redo' | 'palette' | 'run' | 'run-headed' | 'cancel';

interface StudioDesktop {
  isDesktop: true;
  platform: NodeJS.Platform;
  onCommand: (handler: (command: DesktopCommand) => void) => () => void;
  workspaceRoot: () => Promise<string | null>;
  chooseWorkspace: () => Promise<void>;
}

declare global {
  interface Window {
    studioDesktop?: StudioDesktop;
    __studioHasUnsavedWork?: () => boolean;
    __studioSaveNow?: () => Promise<boolean>;
  }
}

export function desktop(): StudioDesktop | null {
  return typeof window !== 'undefined' ? (window.studioDesktop ?? null) : null;
}

export const isDesktop = (): boolean => desktop() != null;
