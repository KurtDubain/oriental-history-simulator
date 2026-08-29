import { Volume2, X } from 'lucide-react';
import '../styles/audio-invitation.css';

export interface AudioInvitationProps {
  open: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}

/**
 * A one-time, observer-only invitation. It is deliberately not a new settings
 * surface: accepting only flips the same local sound preference as Settings.
 */
export function AudioInvitation({ open, onEnable, onDismiss }: AudioInvitationProps) {
  if (!open) return null;

  return (
    <aside className="observer-audio-invitation" aria-label="声音提示" data-testid="audio-invitation">
      <span className="observer-audio-invitation__icon" aria-hidden="true">
        <Volume2 size={17} />
      </span>
      <span className="observer-audio-invitation__copy">
        <strong>想听见这个世界？</strong>
        <small>开启风、水、展卷与史事提示；随时可在设置里静音。</small>
      </span>
      <button type="button" className="observer-audio-invitation__enable" onClick={onEnable}>
        开启声音
      </button>
      <button
        type="button"
        className="observer-audio-invitation__dismiss"
        aria-label="暂不开启声音"
        title="暂不开启"
        onClick={onDismiss}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </aside>
  );
}
