/** Icons for the admin master pages (Pump Model / Gearbox / Pulley / Motor / BOI) and
 * the Access Requests page: lucide-react underneath (shadcn look, user 2026-11-13), the
 * same exports as before. They inherit `currentColor` and default to 1em; CSS on the parent (a shadcn Button,
 * .pmm-btn svg) sizes them as before. */
import { Check, CircleAlert, Info, Pause, Pencil, Play, Plus, Search, Trash2, X } from "lucide-react";

export const PlusIcon = () => <Plus aria-hidden="true" size="1em" />;
export const SearchIcon = () => <Search aria-hidden="true" size="1em" />;
export const DetailsIcon = () => <Info aria-hidden="true" size="1em" />;
export const EditIcon = () => <Pencil aria-hidden="true" size="1em" />;
export const TrashIcon = () => <Trash2 aria-hidden="true" size="1em" />;
export const AlertIcon = () => <CircleAlert aria-hidden="true" size="1em" />;
export const CheckIcon = () => <Check aria-hidden="true" size="1em" />;
export const XIcon = () => <X aria-hidden="true" size="1em" />;
export const PauseIcon = () => <Pause aria-hidden="true" size="1em" />;
export const PlayIcon = () => <Play aria-hidden="true" size="1em" />;
