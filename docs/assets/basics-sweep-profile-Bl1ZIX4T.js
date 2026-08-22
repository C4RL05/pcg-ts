var e=`{\r
  "formatVersion": 1,\r
  "seed": 1045,\r
  "meta": {\r
    "title": "put a real surface on a curve",\r
    "description": "A curve becomes a skin. \`sweepProfile\` places a cross-section on EVERY POINT of a polyline and stitches consecutive placements into three-vertex 'poly' triangles — the same topology \`meshPrimitive\` emits, so the result is not a second class of mesh: \`surfaceSample\`, \`promoteAttribute\` and the 'uv' and 'raycast' transfer mappings all see it. THE PATH IS NOT RESAMPLED. One ring per input point, exactly where the point is, which is why \`radius\` here can be a field: it resolves AT the ring rather than being averaged across a segment's two endpoints the way \`pathSegments\` must, so this taper from 0.9 to 0.15 along \`curveU\` is exact. For a finer surface, run \`pathResample\` first — that is the knob, not a subdivision param. Rings meet through a mitered joint, so the section keeps its radius round a bend instead of pinching by the cosine of the half-angle. The node writes \`normal\` itself rather than leaving \`computeVertexNormals\` to smooth across the uv seam and the caps, and writes \`uv\` with \`u\` as normalized arc length — the same measure \`curveU\` carries, so a texture lines up with anything else measured along this curve.",\r
    "tags": ["basics", "curve", "surface", "mesh", "fields"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "curve",\r
      "type": "subgraph",\r
      "params": { "count": 64, "wander": 0.4, "frequency": 2, "size": [40, 1, 40] },\r
      "ref": { "name": "shape/path-meander" }\r
    },\r
    {\r
      "id": "skin",\r
      "type": "sweepProfile",\r
      "params": {\r
        "profile": "circle",\r
        "sides": 10,\r
        "radius": {\r
          "fn": "remap",\r
          "args": [{ "fn": "attribute", "name": "curveU" }, 0, 1, 0.9, 0.15]\r
        },\r
        "frame": "upHint",\r
        "up": [0, 1, 0],\r
        "roll": 0,\r
        "joint": "miter",\r
        "miterLimit": 4,\r
        "caps": true\r
      }\r
    }\r
  ],\r
  "connections": [{ "from": ["curve", "out"], "to": ["skin", "in"] }],\r
  "outputs": [\r
    { "id": "skin", "pin": "out", "name": "surface" },\r
    { "id": "curve", "pin": "out", "name": "path" }\r
  ]\r
}\r
`;export{e as default};