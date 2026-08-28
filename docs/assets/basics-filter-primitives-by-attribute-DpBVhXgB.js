var e=`{
  "formatVersion": 1,
  "seed": 1047,
  "meta": {
    "title": "keep whole primitives by an attribute comparison",
    "description": "\`filterByAttribute\` one domain up. \`connectPoints\` writes each edge's length onto the PRIMITIVE domain as \`edgeLength\`, and \`filterPrimitivesByAttribute\` compares that column with the same six operators and keeps WHOLE PRIMITIVES: vertices, vertex and primitive columns, and the points they share all survive, so a network that goes in comes out a network. Every point filter would rebuild the point domain instead and the topology would go with it. The same column can be read after a sampler has flattened it onto points — that is how such graphs were written before this node existed — and the difference is that everything downstream then pays for the edges that were always going to be dropped.",
    "tags": ["basics", "filter", "primitives", "topology"]
  },
  "nodes": [
    {
      "id": "camps",
      "type": "pointScatterInBounds",
      "params": {
        "count": 140,
        "boundsMin": [-30, 0, -30],
        "boundsMax": [30, 0, 30]
      }
    },
    {
      "id": "trails",
      "type": "connectPoints",
      "params": { "mode": "radius", "radius": 10, "lengthAttr": "edgeLength" }
    },
    {
      "id": "short",
      "type": "filterPrimitivesByAttribute",
      "params": {
        "attribute": "edgeLength",
        "comparison": "le",
        "value": 6.5,
        "unreferencedPoints": "keep"
      }
    }
  ],
  "connections": [
    { "from": ["camps", "out"], "to": ["trails", "in"] },
    { "from": ["trails", "out"], "to": ["short", "in"] }
  ],
  "outputs": [{ "id": "short", "pin": "out", "name": "network" }]
}
`;export{e as default};