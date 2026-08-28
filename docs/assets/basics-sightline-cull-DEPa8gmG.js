var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "hoardings",\r
      "controls": [\r
        { "param": "props.count", "label": "props", "min": 40, "max": 600, "step": 20 },\r
        { "param": "props.seed", "label": "seed" }\r
      ]\r
    },\r
    {\r
      "title": "the rule",\r
      "controls": [\r
        {\r
          "param": "eyes.spacing",\r
          "label": "eye spacing",\r
          "min": 1,\r
          "max": 10,\r
          "step": 0.5,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "drop.lookAhead",\r
          "label": "look ahead — left",\r
          "min": 0,\r
          "max": 60,\r
          "step": 1,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "push.lookAhead",\r
          "label": "look ahead — right",\r
          "min": 0,\r
          "max": 60,\r
          "step": 1,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "drop.samples",\r
          "label": "chords per eye — left",\r
          "min": 1,\r
          "max": 24,\r
          "step": 1\r
        },\r
        {\r
          "param": "push.samples",\r
          "label": "chords per eye — right",\r
          "min": 1,\r
          "max": 24,\r
          "step": 1\r
        }\r
      ]\r
    },\r
    {\r
      "title": "the repair",\r
      "controls": [\r
        {\r
          "param": "drop.pushMax",\r
          "label": "push limit — left",\r
          "min": 0,\r
          "max": 16,\r
          "step": 0.5,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "push.pushMax",\r
          "label": "push limit — right",\r
          "min": 0,\r
          "max": 16,\r
          "step": 0.5,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "push.pushStep",\r
          "label": "search step — right",\r
          "min": 0.1,\r
          "max": 2,\r
          "step": 0.1,\r
          "unit": " m"\r
        },\r
        {\r
          "param": "push.pushClearance",\r
          "label": "clearance — right",\r
          "min": 0,\r
          "max": 5,\r
          "step": 0.25,\r
          "unit": " m"\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};