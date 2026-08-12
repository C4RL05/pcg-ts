var e=`{\r
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See examples/shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "scatter",\r
      "controls": [\r
        {\r
          "param": "scatter.count",\r
          "label": "candidates",\r
          "min": 100,\r
          "max": 6000,\r
          "step": 100\r
        },\r
        {\r
          "param": "scatter.seed",\r
          "label": "seed"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "thinning",\r
      "controls": [\r
        {\r
          "param": "thin.mode",\r
          "label": "mode"\r
        },\r
        {\r
          "param": "thin.threshold",\r
          "label": "threshold",\r
          "min": 0,\r
          "max": 1,\r
          "step": 0.01\r
        },\r
        {\r
          "param": "thin.seed",\r
          "label": "seed"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};