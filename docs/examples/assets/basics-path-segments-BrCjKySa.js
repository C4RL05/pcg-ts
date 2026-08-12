var e=`{
  "formatVersion": 1,
  "seed": 1041,
  "meta": {
    "title": "draw a curve as solid geometry",
    "description": "A path cannot be drawn. There is no sweep, extrude, loft or revolve in this library, \`meshPrimitive\` builds planes and boxes, and the polyline converter emits lines a pixel wide — so a tube here is not a surface, it is a run of instanced assets. \`pathSegments\` emits ONE point per polyline segment: positioned at the segment's midpoint, \`rot\` turning the chosen local axis onto the segment, and \`scale\` carrying the segment's length on that axis with \`radius\` on the other two. Spawn a unit cylinder — radius 1, height 1 — on those points and each one lands exactly on its segment, so a whole tangle of cable costs a single draw call. The default axis is \`+y\` rather than orientAlongVector's \`+z\` because the assets this feeds are cylinders and capsules, which three.js builds along Y. \`extend\` adds to both ends, closing the wedge consecutive segments leave on the outside of a bend. The OUTPUT IS A PLAIN CLOUD: the points are midpoints, not the curve, so re-pathing them describes the midpoints.",
    "tags": ["basics", "curve", "path", "instancing"]
  },
  "nodes": [
    {
      "id": "curve",
      "type": "subgraph",
      "params": { "count": 48, "wander": 0.18, "frequency": 2.5 },
      "ref": { "name": "shape/path-meander" }
    },
    {
      "id": "tubes",
      "type": "pathSegments",
      "params": { "axis": "+y", "radius": 0.35, "extend": 0.35 }
    },
    {
      "id": "spawn",
      "type": "spawnInstances",
      "params": { "assetId": "tube" }
    }
  ],
  "connections": [
    { "from": ["curve", "out"], "to": ["tubes", "in"] },
    { "from": ["tubes", "out"], "to": ["spawn", "in"] }
  ],
  "outputs": [
    { "id": "spawn", "pin": "instances", "name": "instances" },
    { "id": "tubes", "pin": "out", "name": "points" }
  ]
}
`;export{e as default};