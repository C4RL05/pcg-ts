var e=`{\r
  "_comment": "Panel spec for basics-compose-primitives. Presentation only: which of the graph's exposed params to show, in what order, under what name, and over what range. The graph cooks identically without this file. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "scatter",\r
      "controls": [\r
        { "param": "scatter.count", "label": "points", "min": 200, "max": 20000, "step": 100 },\r
        {\r
          "param": "scatter.minDistance",\r
          "label": "spacing",\r
          "min": 0,\r
          "max": 6,\r
          "step": 0.1,\r
          "unit": " m"\r
        },\r
        { "param": "scatter.seed", "label": "seed" }\r
      ]\r
    },\r
    {\r
      "title": "mask",\r
      "controls": [\r
        { "param": "mask.threshold", "label": "keep above", "min": 0, "max": 1, "step": 0.01 },\r
        { "param": "mask.frequency", "label": "noise scale", "min": 0.005, "max": 0.2, "step": 0.005 },\r
        { "param": "mask.variant", "label": "variant", "min": 0, "max": 20, "step": 1 }\r
      ]\r
    },\r
    {\r
      "title": "size",\r
      "controls": [\r
        { "param": "size.min", "label": "smallest", "min": 0.1, "max": 3, "step": 0.05, "unit": "×" },\r
        { "param": "size.max", "label": "largest", "min": 0.1, "max": 5, "step": 0.05, "unit": "×" },\r
        { "param": "size.seed", "label": "seed" }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};