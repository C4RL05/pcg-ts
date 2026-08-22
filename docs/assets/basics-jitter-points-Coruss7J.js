var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "lattice",\r
      "controls": [\r
        { "param": "grid.countX", "label": "columns", "min": 2, "max": 64, "step": 1 },\r
        { "param": "grid.countZ", "label": "rows", "min": 2, "max": 64, "step": 1 },\r
        { "param": "grid.spacing", "label": "spacing" }\r
      ]\r
    },\r
    {\r
      "title": "jitter",\r
      "controls": [\r
        { "param": "jitter.amount", "label": "amount" },\r
        { "param": "jitter.seed", "label": "seed" }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};