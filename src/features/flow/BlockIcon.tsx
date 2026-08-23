import {
  CircleCheck,
  Code,
  CornerDownLeft,
  FileCheck,
  FunctionSquare,
  GitBranch,
  Globe,
  Keyboard,
  List,
  MessageSquare,
  MousePointerClick,
  Package,
  Pointer,
  Repeat,
  ShieldAlert,
  Square,
  SquareCheck,
  Variable,
  type LucideIcon,
} from 'lucide-react';

// Named imports only: a wildcard import pulls every icon in the library into
// the bundle, which cost roughly a megabyte of JavaScript.
const ICONS: Record<string, LucideIcon> = {
  CircleCheck,
  Code,
  CornerDownLeft,
  FileCheck,
  FunctionSquare,
  GitBranch,
  Globe,
  Keyboard,
  List,
  MessageSquare,
  MousePointerClick,
  Package,
  Pointer,
  Repeat,
  ShieldAlert,
  Square,
  SquareCheck,
  Variable,
};

export function BlockIcon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = ICONS[name] ?? Square;
  return <Component size={size} aria-hidden />;
}
