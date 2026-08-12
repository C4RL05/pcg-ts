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
      "title": "neighbourhood",\r
      "controls": [\r
        {\r
          "param": "crowding.radius",\r
          "label": "radius",\r
          "min": 0.5,\r
          "max": 15,\r
          "step": 0.1,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "crowding.maxCount",\r
          "label": "max counted",\r
          "min": 0,\r
          "max": 64,\r
          "step": 1\r
        },\r
        {\r
          "param": "crowding.includeSelf",\r
          "label": "count self"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};