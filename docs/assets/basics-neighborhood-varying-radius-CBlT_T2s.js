var e=`{\r
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "cloud",\r
      "controls": [\r
        {\r
          "param": "cloud.count",\r
          "label": "points",\r
          "min": 100,\r
          "max": 4000,\r
          "step": 50\r
        },\r
        {\r
          "param": "cloud.seed",\r
          "label": "seed"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "survey",\r
      "controls": [\r
        {\r
          "param": "survey.maxCount",\r
          "label": "max counted",\r
          "min": 0,\r
          "max": 128,\r
          "step": 1\r
        },\r
        {\r
          "param": "survey.includeSelf",\r
          "label": "count self"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};