import type { SVGProps } from "react";

// Simple generic icons. Brand logos live in brand-icons.tsx.
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const SparkIcon = ({ size = 16, ...p }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...p}>
    <path
      d="M12 1.5c.38 4.6 2.3 8.2 6.9 9.75C14.3 12.8 12.38 16.4 12 21c-.38-4.6-2.3-8.2-6.9-9.75C9.7 9.7 11.62 5.1 12 1.5z"
      fill="currentColor"
    />
  </svg>
);
export const SwapIcon = (p: P) => (
  <Svg {...p}><path d="M4 6h10M11 3l3 3-3 3M16 14H6M9 11l-3 3 3 3" {...stroke} /></Svg>
);
export const SendIcon = (p: P) => (
  <Svg {...p}><path d="M4 10h12M12 6l4 4-4 4" {...stroke} /></Svg>
);
export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8.2 11.6l-.8.8a3 3 0 1 1-4.2-4.2l1.6-1.6a3 3 0 0 1 4.2 0M11.8 8.4l.8-.8a3 3 0 1 1 4.2 4.2l-1.6 1.6a3 3 0 0 1-4.2 0" {...stroke} />
  </Svg>
);
export const WalletIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="15" height="11" rx="2.2" {...stroke} strokeWidth={1.5} />
    <path d="M2.5 8h15" {...stroke} strokeWidth={1.5} />
    <circle cx="13.3" cy="11.6" r="1" fill="currentColor" />
  </Svg>
);
export const ChatIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z" {...stroke} />
  </Svg>
);
export const HomeIcon = (p: P) => (
  <Svg {...p}><path d="M3 9l7-5.5L17 9v7.5a1 1 0 0 1-1 1h-3.5v-5h-5v5H4a1 1 0 0 1-1-1V9z" {...stroke} /></Svg>
);
export const ClockIcon = (p: P) => (
  <Svg {...p}><circle cx="10" cy="10" r="7" {...stroke} /><path d="M10 6v4l2.5 1.8" {...stroke} /></Svg>
);
export const GaugeIcon = (p: P) => (
  <Svg {...p}><path d="M3.5 14a6.5 6.5 0 1 1 13 0" {...stroke} /><path d="M10 14l3-4" {...stroke} /></Svg>
);
export const GridIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="5.5" height="5.5" rx="1.2" {...stroke} />
    <rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" {...stroke} />
    <rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" {...stroke} />
    <rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2" {...stroke} />
  </Svg>
);
export const GearIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="2.6" {...stroke} />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" {...stroke} />
  </Svg>
);
export const CopyIcon = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2" {...stroke} />
    <path d="M13 7V5a1.5 1.5 0 0 0-1.5-1.5h-6A1.5 1.5 0 0 0 4 5v6.5A1.5 1.5 0 0 0 5.5 13H7" {...stroke} />
  </Svg>
);
export const ShareIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="14.5" cy="5" r="2" {...stroke} />
    <circle cx="5.5" cy="10" r="2" {...stroke} />
    <circle cx="14.5" cy="15" r="2" {...stroke} />
    <path d="M7.3 9l5.4-3M7.3 11l5.4 3" {...stroke} />
  </Svg>
);
export const CheckIcon = (p: P) => (
  <Svg {...p}><path d="M5 10.5l3.2 3L15 6.5" {...stroke} strokeWidth={1.9} /></Svg>
);
export const ArrowRightIcon = (p: P) => (
  <Svg {...p}><path d="M4 10h12M11.5 5.5L16 10l-4.5 4.5" {...stroke} strokeWidth={1.8} /></Svg>
);
export const BackIcon = (p: P) => (
  <Svg {...p}><path d="M12.5 4.5L7 10l5.5 5.5" {...stroke} strokeWidth={1.9} /></Svg>
);
export const ShieldIcon = (p: P) => (
  <Svg {...p}><path d="M10 2.5l6 2.2v4.6c0 3.9-2.6 6.9-6 8.2-3.4-1.3-6-4.3-6-8.2V4.7l6-2.2z" {...stroke} /><path d="M7.3 10l2 2 3.6-3.8" {...stroke} /></Svg>
);
export const ListIcon = (p: P) => (
  <Svg {...p}><path d="M7 5.5h9M7 10h9M7 14.5h9M3.8 5.5h.01M3.8 10h.01M3.8 14.5h.01" {...stroke} strokeWidth={1.8} /></Svg>
);
export const BankIcon = (p: P) => (
  <Svg {...p}><path d="M3 8l7-4.5L17 8M4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6M3 16.5h14" {...stroke} /></Svg>
);
export const IdIcon = (p: P) => (
  <Svg {...p}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" {...stroke} />
    <circle cx="7.3" cy="9.3" r="1.7" {...stroke} />
    <path d="M4.8 13c.5-1.2 1.4-1.8 2.5-1.8s2 .6 2.5 1.8M12 8.5h3M12 11.5h3" {...stroke} />
  </Svg>
);
export const CoinIcon = (p: P) => (
  <Svg {...p}><circle cx="10" cy="10" r="7" {...stroke} /><path d="M12.2 7.6c-.4-.7-1.2-1.1-2.2-1.1-1.3 0-2.2.7-2.2 1.7 0 2.3 4.6 1.2 4.6 3.6 0 1-1 1.7-2.4 1.7-1.1 0-2-.5-2.4-1.3M10 5v1.5M10 13.5V15" {...stroke} strokeWidth={1.4} /></Svg>
);
export const BoltIcon = (p: P) => (
  <Svg {...p}><path d="M11 2.5L4.5 11h5l-1 6.5L15.5 9h-5l.5-6.5z" {...stroke} /></Svg>
);
export const OutIcon = (p: P) => (
  <Svg {...p}><path d="M8 4.5H5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 5 15.5h3M12.5 13.5L16 10l-3.5-3.5M16 10H8" {...stroke} /></Svg>
);
export const RefreshIcon = (p: P) => (
  <Svg {...p}><path d="M16 10a6 6 0 1 1-1.9-4.4M16 3.5v3h-3" {...stroke} /></Svg>
);
export const MenuIcon = (p: P) => (
  <Svg {...p}><path d="M3.5 6h13M3.5 10h13M3.5 14h13" {...stroke} strokeWidth={1.8} /></Svg>
);
export const CloseIcon = (p: P) => (
  <Svg {...p}><path d="M5 5l10 10M15 5L5 15" {...stroke} strokeWidth={1.8} /></Svg>
);
export const GlobeIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" {...stroke} />
    <path d="M3 10h14M10 3c2 2.2 2.8 4.6 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3z" {...stroke} />
  </Svg>
);
export const TrashIcon = (p: P) => (
  <Svg {...p}><path d="M4 6h12M8 6V4.5h4V6M6 6l.7 10a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6" {...stroke} /></Svg>
);
export const StarIcon = (p: P) => (
  <Svg {...p}><path d="M10 3.2l2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 14l-4.2 2.2.8-4.7-3.4-3.3 4.7-.7z" {...stroke} /></Svg>
);
