var e=`{\r
  "formatVersion": 1,\r
  "seed": 1047,\r
  "meta": {\r
    "title": "keep whole primitives by an attribute comparison",\r
    "description": "\`filterByAttribute\` one domain up. \`connectPoints\` writes each edge's length onto the PRIMITIVE domain as \`edgeLength\`, and \`filterPrimitivesByAttribute\` compares that column with the same six operators and keeps WHOLE PRIMITIVES: vertices, vertex and primitive columns, and the points they share all survive, so a network that goes in comes out a network. Every point filter would rebuild the point domain instead and the topology would go with it. The same column can be read after a sampler has flattened it onto points — that is how such graphs were written before this node existed — and the difference is that everything downstream then pays for the edges that were always going to be dropped.",\r
    "tags": ["basics", "filter", "primitives", "topology"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "camps",\r
      "type": "pointScatterInBounds",\r
      "params": {\r
        "count": 140,\r
        "boundsMin": [-30, 0, -30],\r
        "boundsMax": [30, 0, 30]\r
      }\r
    },\r
    {\r
      "id": "trails",\r
      "type": "connectPoints",\r
      "params": { "mode": "radius", "radius": 10, "lengthAttr": "edgeLength" }\r
    },\r
    {\r
      "id": "short",\r
      "type": "filterPrimitivesByAttribute",\r
      "params": {\r
        "attribute": "edgeLength",\r
        "comparison": "le",\r
        "value": 6.5,\r
        "unreferencedPoints": "keep"\r
      }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["camps", "out"], "to": ["trails", "in"] },\r
    { "from": ["trails", "out"], "to": ["short", "in"] }\r
  ],\r
  "outputs": [{ "id": "short", "pin": "out", "name": "network" }]\r
}\r
`;export{e as default};