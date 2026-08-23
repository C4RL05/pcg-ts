var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "footprint",\r
      "controls": [\r
        { "param": "plot.count", "label": "corners", "min": 3, "max": 48, "step": 1 },\r
        { "param": "plot.size", "label": "size" },\r
        { "param": "plot.rotate", "label": "rotate" }\r
      ]\r
    },\r
    {\r
      "title": "massing",\r
      "controls": [\r
        { "param": "massing.direction", "label": "direction" },\r
        { "param": "massing.vector", "label": "vector" },\r
        { "param": "massing.caps", "label": "caps" },\r
        { "param": "massing.sides", "label": "walls" }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};