var e=`{\r
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See examples/shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "surface",\r
      "controls": [\r
        {\r
          "param": "ground.size",\r
          "label": "size"\r
        },\r
        {\r
          "param": "ground.subdivisions",\r
          "label": "subdivisions"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "samples",\r
      "controls": [\r
        {\r
          "param": "scatter.count",\r
          "label": "points",\r
          "min": 50,\r
          "max": 2000,\r
          "step": 25\r
        },\r
        {\r
          "param": "scatter.seed",\r
          "label": "seed"\r
        },\r
        {\r
          "param": "sampleDown.mapping",\r
          "label": "mapping"\r
        },\r
        {\r
          "param": "sampleDown.direction",\r
          "label": "direction"\r
        },\r
        {\r
          "param": "sampleDown.maxDistance",\r
          "label": "max distance",\r
          "min": 0,\r
          "max": 100,\r
          "step": 1,\r
          "unit": " m"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};