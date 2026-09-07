/**
 * The ZoneLore shield, inline.
 *
 * A copy of `assets/zonelore-icon.svg` transcribed into JSX rather than an <img> or a
 * next/image pointing at it: `web/src/app/icon.svg` exists for Next's favicon
 * convention and is not a URL to be relied on, and `../../assets` is outside the app
 * directory and would not be traced into the standalone bundle. Inline also means the
 * mark paints with the header rather than a frame or two after it, which matters when
 * it sits next to text at the same size as the text.
 *
 * The gradient ids are prefixed because ids in an inline SVG are page-global, and
 * `gold` / `frame` / `field` are exactly the names a second inline SVG would also
 * reach for. `assets/README.md` is the source of truth for the artwork -- a change to
 * the shield means re-copying it here as well, same as the two files that README
 * already lists.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={className}
      // The logo text beside it already says "ZoneLore"; a screen reader announcing the
      // shield too would read the brand twice for one link.
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="brandmark-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF1BE" />
          <stop offset="0.28" stopColor="#F7CE5E" />
          <stop offset="0.62" stopColor="#E09A17" />
          <stop offset="1" stopColor="#8E5A06" />
        </linearGradient>
        <linearGradient id="brandmark-frame" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#FFE79E" />
          <stop offset="0.4" stopColor="#C7902A" />
          <stop offset="0.7" stopColor="#7A4E0B" />
          <stop offset="1" stopColor="#E0B24E" />
        </linearGradient>
        <linearGradient id="brandmark-field" x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#2B3450" />
          <stop offset="0.6" stopColor="#121727" />
          <stop offset="1" stopColor="#06080E" />
        </linearGradient>
      </defs>
      <polygon
        points="56,4 200,4 252,56 252,200 200,252 56,252 4,200 4,56"
        fill="url(#brandmark-frame)"
      />
      <polygon
        points="62,20 194,20 236,62 236,194 194,236 62,236 20,194 20,62"
        fill="url(#brandmark-field)"
      />
      <polygon
        points="62,20 194,20 236,62 236,194 194,236 62,236 20,194 20,62"
        fill="none"
        stroke="#000"
        strokeOpacity="0.5"
        strokeWidth="6"
      />
      <polygon points="62,20 194,20 236,62 138,62 62,20" fill="#8FA6D8" opacity="0.09" />
      <polygon
        points="66,52 120,52 120,152 200,152 200,204 66,204"
        fill="#2E1C03"
        stroke="#2E1C03"
        strokeWidth="13"
        strokeLinejoin="round"
      />
      <polygon
        points="66,52 120,52 120,152 200,152 200,204 66,204"
        fill="url(#brandmark-gold)"
      />
      <polygon points="66,52 90,52 90,204 66,204" fill="#FFFFFF" opacity="0.20" />
      <polygon points="90,52 120,52 120,152 90,166" fill="#000000" opacity="0.16" />
      <polygon points="120,152 200,152 200,168 120,168" fill="#FFFFFF" opacity="0.14" />
      <polygon points="66,190 200,190 200,204 66,204" fill="#000000" opacity="0.28" />
      <polygon
        points="66,52 120,52 120,152 200,152 200,204 66,204"
        fill="none"
        stroke="#FFE9A8"
        strokeOpacity="0.5"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
