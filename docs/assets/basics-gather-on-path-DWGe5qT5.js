var e=`{\r
  "_comment": "Panel spec for basics-gather-on-path. See shared/graphUi.ts — presentation only; the graph cooks identically without it.",\r
  "sections": [\r
    {\r
      "title": "curve",\r
      "controls": [\r
        { "param": "curve.count", "label": "points", "min": 8, "max": 400, "step": 2 },\r
        { "param": "curve.wander", "label": "wander", "min": 0, "max": 1, "step": 0.01 },\r
        { "param": "curve.frequency", "label": "noise scale", "min": 0.2, "max": 12, "step": 0.1 },\r
        { "param": "curve.variant", "label": "variant", "min": 0, "max": 20, "step": 1 },\r
        { "param": "curve.size", "label": "extent" }\r
      ]\r
    },\r
    {\r
      "title": "bundles",\r
      "controls": [\r
        { "param": "bundles.bins", "label": "clumps", "min": 1, "max": 40, "step": 1 },\r
        { "param": "bundles.amount", "label": "pull", "min": 0, "max": 1, "step": 0.02 }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};