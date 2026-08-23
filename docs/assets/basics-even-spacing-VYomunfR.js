var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "spacing",\r
      "controls": [\r
        { "param": "scatter.count", "label": "candidates", "min": 200, "max": 8000, "step": 100 },\r
        {\r
          "param": "prune.minDistance",\r
          "label": "min distance",\r
          "min": 0.5,\r
          "max": 10,\r
          "step": 0.1,\r
          "unit": " m"\r
        },\r
        { "param": "scatter.boundsMin", "label": "bounds min" },\r
        { "param": "scatter.boundsMax", "label": "bounds max" }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};