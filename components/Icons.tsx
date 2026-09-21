export function MicIcon({ live }: { live?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={live ? "#ff6b6b" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {live ? (
        <rect x="6" y="6" width="12" height="12" rx="2.5" fill="#ff6b6b" stroke="none" />
      ) : (
        <>
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </>
      )}
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
