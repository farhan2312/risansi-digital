/** Shared "colored initials circle" helpers -- originally built for the Bug
 * Reports Kanban cards, now reused by the Users & Access table too, so both
 * places assign the same person the same color consistently. */

const AVATAR_COLORS = ["#f97066", "#f79009", "#2e90fa", "#7a5af8", "#ee46bc", "#0ba5ec", "#84cc16", "#fb7185"];

export const avatarColor = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};

export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
