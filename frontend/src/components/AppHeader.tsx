import { BackIcon } from "./Icons";

interface AppHeaderProps {
  onBack?: () => void;
}

export function AppHeader({ onBack }: AppHeaderProps) {
  return (
    <header className="app-header">
      {onBack ? (
        <button className="header-back" type="button" onClick={onBack} aria-label="返回">
          <BackIcon />
        </button>
      ) : null}
      <div className="brand" aria-label="Karaoke Pitch Lab">
        KARAOKE <span>PITCH</span> LAB
      </div>
    </header>
  );
}
