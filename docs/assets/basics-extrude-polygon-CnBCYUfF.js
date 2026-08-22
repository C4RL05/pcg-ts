var e=`{\r
  "formatVersion": 1,\r
  "seed": 1046,\r
  "meta": {\r
    "title": "turn a footprint into massing",\r
    "description": "A closed polyline is already a plan; \`extrudePolygon\` gives it a third dimension. The boundary is swept along a direction into three-vertex 'poly' triangles — walls, a floor and a roof — and until this node existed a graph that had computed its plots could only draw them as hairlines, which is why a settlement pipeline puts a pre-made house on a lot CENTRE while the lot's own shape goes unshown. \`distance\` is field-capable and resolves on the INPUT points, so a per-point value gives a SLOPED top rather than a flat one: the noise here lifts each corner of the plan by a different amount. Walls, roof and floor keep SEPARATE points, so the eaves stay a crease instead of being shaded round, and the winding is derived from the polygon's own Newell normal against the direction — a footprint wound either way comes out facing outward. Caps are fan-triangulated from the boundary's first point, which is exact for a CONVEX plan and is all the topology records. An OPEN polyline is refused by name: extrusion is not defined on one, and the fix is \`pointsToPath\` with \`closed: true\`.",\r
    "tags": ["basics", "surface", "mesh", "extrude", "fields"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "plot",\r
      "type": "subgraph",\r
      "params": { "count": 7, "size": [9, 9, 9], "center": [0, 0, 0], "rotate": [0, 0, 0] },\r
      "ref": { "name": "shape/path-loop" }\r
    },\r
    {\r
      "id": "massing",\r
      "type": "extrudePolygon",\r
      "params": {\r
        "distance": {\r
          "fn": "remap",\r
          "args": [\r
            {\r
              "fn": "perlinNoise",\r
              "opts": {\r
                "frequency": 0.09,\r
                "seed": { "from": "node", "variant": 5 },\r
                "normalized": true,\r
                "position": { "fn": "position" }\r
              }\r
            },\r
            0,\r
            1,\r
            5,\r
            13\r
          ]\r
        },\r
        "direction": "+y",\r
        "vector": [0, 1, 0],\r
        "caps": "both",\r
        "sides": true\r
      }\r
    }\r
  ],\r
  "connections": [{ "from": ["plot", "out"], "to": ["massing", "in"] }],\r
  "outputs": [\r
    { "id": "massing", "pin": "out", "name": "massing" },\r
    { "id": "plot", "pin": "out", "name": "footprint" }\r
  ]\r
}\r
`;export{e as default};