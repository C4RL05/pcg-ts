var e=`{
  "formatVersion": 1,
  "seed": 1012,
  "meta": {
    "title": "build a mesh a saved graph can cook",
    "description": "\`meshPrimitive\` is the only mesh source that survives serialization — \`dataInput\`'s items are injected at runtime and a saved graph carries none — so a graph that must cook from JSON alone gets its surface from here. The output carries P and a \`uv\` point attribute, plus one three-vertex 'poly' primitive per triangle: exactly the topology \`surfaceSample\`, \`promoteAttribute\`, and the 'uv' and 'raycast' transfer mappings need.",
    "tags": ["basics", "mesh", "source", "serialization"]
  },
  "nodes": [
    {
      "id": "ground",
      "type": "meshPrimitive",
      "params": {
        "shape": "plane",
        "size": [40, 0, 40],
        "center": [0, 0, 0],
        "orientation": "xz",
        "subdivisions": [8, 1, 8]
      }
    }
  ],
  "connections": [],
  "outputs": [{ "id": "ground", "pin": "out", "name": "mesh" }]
}
`;export{e as default};