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
          "max": 2000,\r
          "step": 25\r
        },\r
        {\r
          "param": "scatter.boundsMin",\r
          "label": "bounds min"\r
        },\r
        {\r
          "param": "scatter.boundsMax",\r
          "label": "bounds max"\r
        },\r
        {\r
          "param": "scatter.seed",\r
          "label": "seed"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "spawn",\r
      "controls": [\r
        {\r
          "param": "spawn.assetId",\r
          "label": "fallback asset"\r
        },\r
        {\r
          "param": "spawn.assetAttr",\r
          "label": "split by"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};