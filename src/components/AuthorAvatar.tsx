import { getAuthorInitials } from '../services/parsers/authorNormalizer';

const AVATAR_PALETTES = [
  'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash % AVATAR_PALETTES.length;
}

interface AuthorAvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
}

export function AuthorAvatar({ name, size = 'md' }: AuthorAvatarProps) {
  const initials = getAuthorInitials(name);
  const colorClass = AVATAR_PALETTES[hashName(name)];
  const sizeClass =
    size === 'sm'
      ? 'w-7 h-7 text-xs'
      : size === 'lg'
        ? 'w-11 h-11 text-sm'
        : 'w-9 h-9 text-xs';

  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-semibold tracking-tight ${sizeClass} ${colorClass}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
