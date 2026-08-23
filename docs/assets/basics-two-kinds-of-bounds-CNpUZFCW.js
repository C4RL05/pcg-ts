var e=`{\r
  "formatVersion": 1,\r
  "seed": 1061,\r
  "meta": {\r
    "title": "two things called bounds, and they are not the same thing",\r
    "description": "The word does double duty in this library and confusing the two costs an afternoon, so here they are in one graph.\\n\\n\`filterPrimitivesByBounds\` is a WORLD box that SELECTS. It keeps or drops whole primitives by testing their vertices against [boundsMin, boundsMax], and it is one of only two filters here that PRESERVE TOPOLOGY — the survivors keep their vertices, their vertex and primitive attributes, and the points they share, so a network filtered this way is still a network rather than a cloud that used to be one. Three params decide what 'in the box' means and they are read together. \`vertex: \\"first\\"\` tests exactly ONE vertex per primitive, which is what makes it an OWNERSHIP rule: every primitive has exactly one first vertex, so abutting boxes claim it exactly once between them and a partitioned cook can tile the world with no edge counted twice. \`boundary: \\"halfOpen\\"\` is the other half of that — min inclusive, max exclusive — so an edge lying exactly on a shared face belongs to one box, not both. A consequence worth seeing before it surprises you: only the FIRST vertex is tested, so an edge that starts inside and ends well outside survives WHOLE, and the filtered network overhangs its own box — about forty percent of the points left here sit outside [-12, 12]. That is the ownership rule working, not leaking: the box owns edges, not space. And \`unreferencedPoints: \\"drop\\"\`, used here, discards the points no surviving edge touches; the default 'keep' leaves the point domain completely untouched instead, same points in the same order, which is what anything holding a point index needs.\\n\\n\`setBounds\` is a per-point LOCAL extent that DESCRIBES. It writes \`boundsMin\` and \`boundsMax\` on every point as that point's own axis-aligned size, in world units, and nothing filters on it — spawners and downstream nodes read it to know how much room the thing at that point takes up. Constants here for legibility, but the param is field-capable and that is where it earns its place: an extent derived from the point's own \`scale\`, or chosen by a species attribute, gives every instance the box it actually occupies instead of one box for the whole cloud. Note also what it does NOT check — min against max is not validated, the two corners are written independently, and a point whose corners cross is a point with an inside-out box.\\n\\nSo: one bounds is a question asked of the world, the other is an answer a point carries about itself. They share a name and a shape and nothing else.",\r
    "tags": ["basics", "bounds", "filter", "topology"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "camps",\r
      "type": "pointScatterInBounds",\r
      "params": { "count": 300, "boundsMin": [-24, 0, -24], "boundsMax": [24, 0, 24] }\r
    },\r
    {\r
      "id": "net",\r
      "type": "connectPoints",\r
      "params": { "mode": "radius", "radius": 6, "degreeAttr": "degree", "lengthAttr": "edgeLength" }\r
    },\r
    {\r
      "id": "keep",\r
      "type": "filterPrimitivesByBounds",\r
      "params": {\r
        "boundsMin": [-12, -1, -12],\r
        "boundsMax": [12, 1, 12],\r
        "vertex": "first",\r
        "mode": "inside",\r
        "boundary": "halfOpen",\r
        "unreferencedPoints": "drop"\r
      }\r
    },\r
    {\r
      "id": "extent",\r
      "type": "setBounds",\r
      "params": { "boundsMin": [-0.4, 0, -0.4], "boundsMax": [0.4, 2.2, 0.4] }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["camps", "out"], "to": ["net", "in"] },\r
    { "from": ["net", "out"], "to": ["keep", "in"] },\r
    { "from": ["keep", "out"], "to": ["extent", "in"] }\r
  ],\r
  "outputs": [{ "id": "extent", "pin": "out", "name": "network" }]\r
}\r
`;export{e as default};