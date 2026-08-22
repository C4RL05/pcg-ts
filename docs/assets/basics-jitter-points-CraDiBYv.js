var e=`{\r
  "formatVersion": 1,\r
  "seed": 1009,\r
  "meta": {\r
    "title": "break up a lattice with deterministic jitter",\r
    "description": "\`jitterPoints\` offsets each point by a random vector drawn per axis from (seed, point index, axis), so the result is reproducible and independent of cook order — the lattice stops reading as a lattice without giving up determinism. \`amount\` is the maximum offset per axis and is field-capable, so the jitter can itself vary across space; here y is left at 0 to keep the cloud flat.",\r
    "tags": ["basics", "jitter", "determinism"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "grid",\r
      "type": "pointGrid",\r
      "params": {\r
        "countX": 16,\r
        "countY": 1,\r
        "countZ": 16,\r
        "spacing": [3, 0, 3],\r
        "origin": [-22.5, 0, -22.5]\r
      }\r
    },\r
    {\r
      "id": "jitter",\r
      "type": "jitterPoints",\r
      "params": { "amount": [1.2, 0, 1.2], "seed": 4 }\r
    }\r
  ],\r
  "connections": [{ "from": ["grid", "out"], "to": ["jitter", "in"] }],\r
  "outputs": [{ "id": "jitter", "pin": "out", "name": "points" }]\r
}\r
`;export{e as default};