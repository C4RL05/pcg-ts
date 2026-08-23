var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "curve",\r
      "controls": [\r
        { "param": "curve.count", "label": "path points", "min": 4, "max": 400, "step": 1 },\r
        { "param": "curve.wander", "label": "wander", "min": 0, "max": 1, "step": 0.01 },\r
        { "param": "curve.frequency", "label": "bends", "min": 0.5, "max": 8, "step": 0.1 }\r
      ]\r
    },\r
    {\r
      "title": "surface",\r
      "controls": [\r
        { "param": "skin.profile", "label": "profile" },\r
        { "param": "skin.sides", "label": "sides", "min": 3, "max": 64, "step": 1 },\r
        { "param": "skin.width", "label": "ribbon width", "min": 0.1, "max": 8, "step": 0.1 },\r
        { "param": "skin.roll", "label": "roll", "min": -1, "max": 1, "step": 0.01, "unit": "turns" },\r
        { "param": "skin.frame", "label": "frame" },\r
        { "param": "skin.joint", "label": "joint" },\r
        { "param": "skin.miterLimit", "label": "miter limit", "min": 1, "max": 16, "step": 0.1 },\r
        { "param": "skin.caps", "label": "caps" }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};