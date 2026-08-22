var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "terrain",\r
      "controls": [\r
        { "param": "terrain.amount", "label": "relief", "min": 0, "max": 60, "step": 1, "unit": " m" },\r
        { "param": "terrain.frequency", "label": "noise scale", "min": 0.005, "max": 0.08, "step": 0.001 },\r
        { "param": "terrain.variant", "label": "variant", "min": 0, "max": 20, "step": 1 }\r
      ]\r
    },\r
    {\r
      "title": "planting",\r
      "controls": [\r
        { "param": "scatter.count", "label": "candidates", "min": 200, "max": 6000, "step": 100 },\r
        { "param": "gentle.value", "label": "max slope", "min": 0, "max": 0.6, "step": 0.01 },\r
        { "param": "treeline.value", "label": "treeline", "min": -12, "max": 12, "step": 0.5, "unit": " m" }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};