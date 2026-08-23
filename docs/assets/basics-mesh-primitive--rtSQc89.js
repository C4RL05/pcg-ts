var e=`{\r
  "formatVersion": 1,\r
  "seed": 1012,\r
  "meta": {\r
    "title": "build a mesh a saved graph can cook",\r
    "description": "\`meshPrimitive\` is the only mesh source that survives serialization — \`dataInput\`'s items are injected at runtime and a saved graph carries none — so a graph that must cook from JSON alone gets its surface from here. The output carries P and a \`uv\` point attribute, plus one three-vertex 'poly' primitive per triangle: exactly the topology \`surfaceSample\`, \`promoteAttribute\`, and the 'uv' and 'raycast' transfer mappings need.",\r
    "tags": ["basics", "mesh", "source", "serialization"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ground",\r
      "type": "meshPrimitive",\r
      "params": {\r
        "shape": "plane",\r
        "size": [40, 0, 40],\r
        "center": [0, 0, 0],\r
        "orientation": "xz",\r
        "subdivisions": [8, 1, 8]\r
      }\r
    }\r
  ],\r
  "connections": [],\r
  "outputs": [{ "id": "ground", "pin": "out", "name": "mesh" }]\r
}\r
`;export{e as default};