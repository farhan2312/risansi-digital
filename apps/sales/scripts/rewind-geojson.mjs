#!/usr/bin/env node
// Rewind a GeoJSON's rings to the right-hand rule (RFC 7946).
//
// Why this exists: d3-geo, which react-simple-maps draws with, treats polygons
// as SPHERICAL. A ring wound the wrong way does not come out mirrored or
// skewed — it comes out as the entire globe MINUS the shape. Thirty-six states
// wound backwards paint thirty-six full-canvas rectangles on top of each
// other, which is a blank map, and that is exactly what the boundary swap
// shipped.
//
// The target convention is NOT taken on faith. d3-geo wants the opposite
// winding from RFC 7946 §3.1.6, which is easy to misremember in either
// direction, so each exterior ring is tested with geoArea itself: if the ring
// alone encloses more than half the globe it is backwards, and it is
// reversed. Holes are then wound opposite to their exterior. That makes the
// script correct by measurement rather than by convention, and it stays
// correct if a future file arrives in the other orientation.
//
// Run it on any boundary file before committing it:
//
//   node scripts/rewind-geojson.mjs public/india-states-goi.json
//
// It is idempotent: a file already wound correctly comes out byte-identical
// in ring order, and the script says it changed nothing.

import fs from 'node:fs';
import { geoArea } from 'd3-geo';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/rewind-geojson.mjs <file.geojson>');
  process.exit(1);
}

/** Planar signed area, doubled. Positive = clockwise in lng/lat order. */
function shoelace(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[i][0] - ring[j][0]) * (ring[i][1] + ring[j][1]);
  }
  return sum;
}

const isClockwise = ring => shoelace(ring) > 0;
const HALF_SPHERE = 2 * Math.PI;

/**
 * Exterior wound so d3-geo reads it as the small side; holes wound opposite.
 *
 * The exterior is judged by spherical area, because that is the thing that
 * actually goes wrong — a backwards ring measures the whole globe. The holes
 * are judged by planar orientation relative to the exterior, which is all a
 * hole has to get right.
 */
function rewindPolygon(rings) {
  let changed = 0;
  const outer = rings[0];
  if (geoArea({ type: 'Polygon', coordinates: [outer] }) > HALF_SPHERE) {
    outer.reverse(); changed++;
  }
  const outerCw = isClockwise(outer);
  for (let i = 1; i < rings.length; i++) {
    if (isClockwise(rings[i]) === outerCw) { rings[i].reverse(); changed++; }
  }
  return changed;
}

function rewindGeometry(geom) {
  if (!geom) return 0;
  if (geom.type === 'Polygon')      return rewindPolygon(geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((n, p) => n + rewindPolygon(p), 0);
  if (geom.type === 'GeometryCollection') return geom.geometries.reduce((n, g) => n + rewindGeometry(g), 0);
  return 0;
}

const gj = JSON.parse(fs.readFileSync(file, 'utf8'));
const features = gj.type === 'FeatureCollection' ? gj.features : [gj];

const SPHERE = 4 * Math.PI;
const before = features.filter(f => geoArea(f) > SPHERE / 2).length;

let rings = 0;
for (const f of features) rings += rewindGeometry(f.geometry);

const after = features.filter(f => geoArea(f) > SPHERE / 2).length;

if (after > 0) {
  console.error(`FAILED: ${after} feature(s) still cover more than half the globe.`);
  process.exit(1);
}

if (rings === 0) {
  console.log(`${file}: already wound correctly, nothing written.`);
  process.exit(0);
}

fs.writeFileSync(file, JSON.stringify(gj));
const total = features.reduce((s, f) => s + geoArea(f), 0);
console.log(`${file}`);
console.log(`  ${rings} ring(s) reversed across ${features.length} feature(s)`);
console.log(`  inverted features: ${before} -> ${after}`);
console.log(`  total area: ${total.toFixed(4)} sr (${Math.round(total * 6371 * 6371).toLocaleString('en-IN')} km2)`);
