var e=`{\r
 "formatVersion": 1,\r
 "seed": 2402,\r
 "meta": {\r
  "title": "plant a hillside, thinned by slope and treeline",\r
  "description": "The forest recipe as one serialized graph. A displaced plane is the terrain; \`surfaceSample\` scatters candidates over it carrying the flat per-triangle \`normal\`; two attributes derived from that geometry \\u2014 \`height\` from the point's own Y, \`slope\` as \`1 - normal.y\` \\u2014 become the two \`filterByAttribute\` gates that decide where a tree is allowed. Scale is stamped BEFORE the filters, since it depends on nothing they decide. The last attribute is a string: \`species\` selects into \`values\` per point, mixing roughly three pines to one bush, and the spawner splits by it.",\r
  "tags": [\r
   "examples",\r
   "terrain",\r
   "placement",\r
   "filter",\r
   "spawner"\r
  ]\r
 },\r
 "nodes": [\r
  {\r
   "id": "ground",\r
   "type": "meshPrimitive",\r
   "params": {\r
    "shape": "plane",\r
    "size": [\r
     200,\r
     0,\r
     200\r
    ],\r
    "orientation": "xz",\r
    "subdivisions": [\r
     64,\r
     1,\r
     64\r
    ]\r
   }\r
  },\r
  {\r
   "id": "terrain",\r
   "type": "subgraph",\r
   "ref": {\r
    "name": "transform/displace-by-noise"\r
   },\r
   "params": {\r
    "amount": 30,\r
    "frequency": 0.03,\r
    "variant": 0\r
   }\r
  },\r
  {\r
   "id": "scatter",\r
   "type": "surfaceSample",\r
   "params": {\r
    "count": 2500\r
   }\r
  },\r
  {\r
   "id": "height",\r
   "type": "setAttribute",\r
   "params": {\r
    "name": "height",\r
    "tupleSize": 1,\r
    "value": {\r
     "fn": "component",\r
     "args": [\r
      {\r
       "fn": "position"\r
      }\r
     ],\r
     "index": 1\r
    }\r
   }\r
  },\r
  {\r
   "id": "slope",\r
   "type": "setAttribute",\r
   "params": {\r
    "name": "slope",\r
    "tupleSize": 1,\r
    "value": {\r
     "fn": "sub",\r
     "args": [\r
      {\r
       "fn": "constant",\r
       "value": 1\r
      },\r
      {\r
       "fn": "component",\r
       "args": [\r
        {\r
         "fn": "attribute",\r
         "name": "normal",\r
         "tupleSize": 3\r
        }\r
       ],\r
       "index": 1\r
      }\r
     ]\r
    }\r
   }\r
  },\r
  {\r
   "id": "size",\r
   "type": "setAttribute",\r
   "params": {\r
    "name": "scale",\r
    "tupleSize": 3,\r
    "value": {\r
     "fn": "vec",\r
     "args": [\r
      {\r
       "fn": "remap",\r
       "args": [\r
        {\r
         "fn": "randomField",\r
         "key": "size"\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 0\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 1\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 0.6\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 1.5\r
        }\r
       ]\r
      },\r
      {\r
       "fn": "remap",\r
       "args": [\r
        {\r
         "fn": "randomField",\r
         "key": "size"\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 0\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 1\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 0.6\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 1.5\r
        }\r
       ]\r
      },\r
      {\r
       "fn": "remap",\r
       "args": [\r
        {\r
         "fn": "randomField",\r
         "key": "size"\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 0\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 1\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 0.6\r
        },\r
        {\r
         "fn": "constant",\r
         "value": 1.5\r
        }\r
       ]\r
      }\r
     ]\r
    }\r
   }\r
  },\r
  {\r
   "id": "gentle",\r
   "type": "filterByAttribute",\r
   "params": {\r
    "attribute": "slope",\r
    "comparison": "le",\r
    "value": 0.28\r
   }\r
  },\r
  {\r
   "id": "treeline",\r
   "type": "filterByAttribute",\r
   "params": {\r
    "attribute": "height",\r
    "comparison": "le",\r
    "value": 5\r
   }\r
  },\r
  {\r
   "id": "species",\r
   "type": "setAttribute",\r
   "params": {\r
    "name": "species",\r
    "type": "string",\r
    "values": [\r
     "pine",\r
     "bush"\r
    ],\r
    "value": {\r
     "fn": "ge",\r
     "args": [\r
      {\r
       "fn": "randomField",\r
       "key": "species"\r
      },\r
      {\r
       "fn": "constant",\r
       "value": 0.72\r
      }\r
     ]\r
    }\r
   }\r
  },\r
  {\r
   "id": "spawn",\r
   "type": "spawnInstances",\r
   "params": {\r
    "assetId": "pine",\r
    "assetAttr": "species"\r
   }\r
  }\r
 ],\r
 "connections": [\r
  {\r
   "from": [\r
    "ground",\r
    "out"\r
   ],\r
   "to": [\r
    "terrain",\r
    "in"\r
   ]\r
  },\r
  {\r
   "from": [\r
    "terrain",\r
    "out"\r
   ],\r
   "to": [\r
    "scatter",\r
    "in"\r
   ]\r
  },\r
  {\r
   "from": [\r
    "scatter",\r
    "out"\r
   ],\r
   "to": [\r
    "height",\r
    "in"\r
   ]\r
  },\r
  {\r
   "from": [\r
    "height",\r
    "out"\r
   ],\r
   "to": [\r
    "slope",\r
    "in"\r
   ]\r
  },\r
  {\r
   "from": [\r
    "slope",\r
    "out"\r
   ],\r
   "to": [\r
    "size",\r
    "in"\r
   ]\r
  },\r
  {\r
   "from": [\r
    "size",\r
    "out"\r
   ],\r
   "to": [\r
    "gentle",\r
    "in"\r
   ]\r
  },\r
  {\r
   "from": [\r
    "gentle",\r
    "out"\r
   ],\r
   "to": [\r
    "treeline",\r
    "in"\r
   ]\r
  },\r
  {\r
   "from": [\r
    "treeline",\r
    "out"\r
   ],\r
   "to": [\r
    "species",\r
    "in"\r
   ]\r
  },\r
  {\r
   "from": [\r
    "species",\r
    "out"\r
   ],\r
   "to": [\r
    "spawn",\r
    "in"\r
   ]\r
  }\r
 ],\r
 "outputs": [\r
  {\r
   "id": "terrain",\r
   "pin": "out",\r
   "name": "terrain"\r
  },\r
  {\r
   "id": "spawn",\r
   "pin": "instances",\r
   "name": "instances"\r
  }\r
 ]\r
}\r
`;export{e as default};