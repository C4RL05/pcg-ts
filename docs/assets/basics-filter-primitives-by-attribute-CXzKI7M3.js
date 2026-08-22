var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "network",\r
      "controls": [\r
        { "param": "camps.count", "label": "camps", "min": 8, "max": 600, "step": 1 },\r
        { "param": "trails.radius", "label": "connect within", "min": 2, "max": 30, "step": 0.5, "unit": "m" }\r
      ]\r
    },\r
    {\r
      "title": "filter",\r
      "controls": [\r
        { "param": "short.comparison", "label": "keep edges" },\r
        { "param": "short.value", "label": "length", "min": 0, "max": 30, "step": 0.5, "unit": "m" },\r
        { "param": "short.unreferencedPoints", "label": "leftover points" }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};