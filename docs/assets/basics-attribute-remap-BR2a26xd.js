var e=`{\r
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "scatter",\r
      "controls": [\r
        {\r
          "param": "scatter.count",\r
          "label": "points",\r
          "min": 50,\r
          "max": 3000,\r
          "step": 50\r
        },\r
        {\r
          "param": "scatter.seed",\r
          "label": "seed"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "remap",\r
      "controls": [\r
        {\r
          "param": "fit.mode",\r
          "label": "mode"\r
        },\r
        {\r
          "param": "fit.inMin",\r
          "label": "in min",\r
          "min": -2,\r
          "max": 2,\r
          "step": 0.05\r
        },\r
        {\r
          "param": "fit.inMax",\r
          "label": "in max",\r
          "min": -2,\r
          "max": 2,\r
          "step": 0.05\r
        },\r
        {\r
          "param": "fit.outMin",\r
          "label": "out min",\r
          "min": -5,\r
          "max": 5,\r
          "step": 0.1\r
        },\r
        {\r
          "param": "fit.outMax",\r
          "label": "out max",\r
          "min": -5,\r
          "max": 5,\r
          "step": 0.1\r
        },\r
        {\r
          "param": "fit.clamp",\r
          "label": "clamp"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};