/** The TradeLikeHunter reticle mark. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="33" fill="none" stroke="rgb(var(--brand))" strokeWidth="7" />
      <g stroke="rgb(var(--brand))" strokeWidth="7" strokeLinecap="round">
        <line x1="50" y1="6" x2="50" y2="16" />
        <line x1="50" y1="84" x2="50" y2="94" />
        <line x1="6" y1="50" x2="16" y2="50" />
        <line x1="84" y1="50" x2="94" y2="50" />
      </g>
      <path d="M50 30 L66 50 L57 50 L57 70 L43 70 L43 50 L34 50 Z" fill="rgb(var(--profit))" />
    </svg>
  );
}
