import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function withDefaults(width: number, height: number, props: IconProps) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    width,
    height,
    'aria-hidden': true,
    focusable: false,
    ...props,
  };
}

export function GearIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M3 7a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.4 7H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M4 7h16" />
      <path d="M10 11v6m4-6v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function ArrowDownIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function PinIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M9 3h6" />
      <path d="M10 3v6l-2.5 3h9L14 9V3" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <rect x="3.5" y="3.5" width="7" height="9" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="15.5" width="7" height="5" rx="1.5" />
    </svg>
  );
}

export function PackageIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" />
      <path d="m3 7.5 9 4.5 9-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function HardDriveIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M7 15h.01" />
      <path d="M11 15h6" />
    </svg>
  );
}

export function PanelLeftIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M9 4.5v15" />
    </svg>
  );
}

export function PowerIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M12 3v9" />
      <path d="M6.5 6.5a8 8 0 1 0 11 0" />
    </svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

export function AppWindowIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9h17" />
      <path d="M7 6.75h.01" />
      <path d="M10 6.75h.01" />
    </svg>
  );
}

export function UninstallIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M12 3.5v9" />
      <path d="m8.5 9 3.5 3.5L15.5 9" />
      <path d="M4.5 14.5v3a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-3" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

export function SparkleIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6.3 6.3 2.1 2.1M15.6 15.6l2.1 2.1M6.3 17.7l2.1-2.1M15.6 8.4l2.1-2.1" />
    </svg>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <rect x="3" y="3" width="11" height="11" rx="1.5" />
      <rect x="16" y="3" width="5" height="7" rx="1.5" />
      <rect x="16" y="12" width="5" height="9" rx="1.5" />
      <rect x="3" y="16" width="11" height="5" rx="1.5" />
    </svg>
  );
}

export function CodeIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />
    </svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...withDefaults(24, 24, props)}>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}
