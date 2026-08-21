import type { UserStatus } from "@aether/shared";
import { cn, colorFromId, initials } from "@/lib/utils";

const STATUS_COLOR: Record<UserStatus, string> = {
  ONLINE: "bg-signal-online",
  IDLE: "bg-signal-idle",
  DND: "bg-signal-dnd",
  OFFLINE: "bg-signal-offline",
};

const SIZES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-[11px]",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
} as const;

export function Avatar({
  userId,
  name,
  src,
  status,
  size = "sm",
  speaking = false,
  className,
}: {
  userId: string;
  name: string;
  src?: string | null;
  status?: UserStatus;
  size?: keyof typeof SIZES;
  /** anel de "falando" — usado a partir da fase 4 */
  speaking?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-md font-medium text-ink-100 transition-shadow duration-100",
          SIZES[size],
          speaking && "speaking-ring",
        )}
        style={src ? undefined : { backgroundColor: colorFromId(userId) }}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="h-full w-full object-cover" />
        ) : (
          initials(name)
        )}
      </div>
      {status ? (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-base-900",
            size === "lg" ? "h-4 w-4" : "h-3 w-3",
            STATUS_COLOR[status],
          )}
          aria-label={status}
        />
      ) : null}
    </div>
  );
}
