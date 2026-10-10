/**
 * The four ambient background layers, straight from the static page:
 *
 *   0  aurora blobs      slow drifting brand-colour light
 *   1  spotlight cone     top-centre beam
 *   2  grid + fade mask   technical texture
 *   3  scan beams         vertical light streaks
 *
 * Fixed and `aria-hidden`, so it is decoration the screen reader never sees.
 * Everything about how it looks lives in the stylesheet; the markup is only
 * the elements those rules need.
 */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="aurora">
        <span className="a1" />
        <span className="a2" />
        <span className="a3" />
      </div>
      <div className="spotlight" />
      <div className="grid-layer" />
      <div className="beams">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
