var e=`{\r
  "_comment": "Panel spec \\u2014 presentation only; the graph cooks identically without it. See examples/shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "surface",\r
      "controls": [\r
        {\r
          "param": "rock.shape",\r
          "label": "shape"\r
        },\r
        {\r
          "param": "rock.size",\r
          "label": "size"\r
        },\r
        {\r
          "param": "rock.subdivisions",\r
          "label": "subdivisions"\r
        }\r
      ]\r
    },\r
    {\r
      "title": "sampling",\r
      "controls": [\r
        {\r
          "param": "onSurface.count",\r
          "label": "points",\r
          "min": 50,\r
          "max": 4000,\r
          "step": 50\r
        },\r
        {\r
          "param": "onSurface.densityField",\r
          "label": "density",\r
          "min": 0,\r
          "max": 1,\r
          "step": 0.01\r
        },\r
        {\r
          "param": "onSurface.seed",\r
          "label": "seed"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};