// Table view or Split view, the viewer's choice from the profile menu: kept
// in a cookie so the server draws the page as chosen on the first paint.
// Plain module: the toggle (client) and the pages (server) read one name.

export const VIEW_MODE_COOKIE = "so2d_view";

export type ViewMode = "table" | "split";

export const viewModeOf = (value: string | undefined): ViewMode => (value === "split" ? "split" : "table");

/** The sidebar collapsed to its icons, the viewer's choice (a cookie, so the first paint is right). */
export const SIDEBAR_COOKIE = "so2d_sidebar";
