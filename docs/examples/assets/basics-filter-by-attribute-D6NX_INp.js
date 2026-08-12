var e=`{\r
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See examples/shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "scatter",\r
      "controls": [\r
        {\r
          "param": "scatter.count",\r
          "label": "points",\r
          "min": 50,\r
          "max": 4000,\r
          "step": 50\r
        },\r
        {\r
          "param": "scatter.seed",\r
          "label": "seed"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "gate",\r
      "controls": [\r
        {\r
          "param": "ridge.comparison",\r
          "label": "keep where"\r
        },\r
        {\r
          "param": "ridge.value",\r
          "label": "threshold",\r
          "min": -1,\r
          "max": 1,\r
          "step": 0.01\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};