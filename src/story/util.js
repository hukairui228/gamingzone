// Helpers shared by story scripts.

/** sequential original voice clips: voice('CH1_M02_TEXT') -> cin_CH1_M02_TEXT_00, _01 ... */
export function voice(prefix) {
  let i = 0;
  return () => `cin_${prefix.toLowerCase()}_${String(i++).padStart(2, '0')}`;
}

/** nearest road point (offset >0 = sidewalk side) */
export function road(m, x, z, off = 0) {
  const R = m.g.roads, n = R.nearest(x, z, 200);
  if (!n) return [x, z, 0];
  const e = R.edges[n.e], p = R.point(e, 1, n.s, off ? R.sidewalkOffset(e) * Math.sign(off) : 0, {});
  return [p.x, p.z, Math.atan2(p.tx, p.tz)];
}

