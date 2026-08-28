var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "hoardings",
      "controls": [
        { "param": "props.count", "label": "props", "min": 40, "max": 600, "step": 20 },
        { "param": "props.seed", "label": "seed" }
      ]
    },
    {
      "title": "the rule",
      "controls": [
        {
          "param": "eyes.spacing",
          "label": "eye spacing",
          "min": 1,
          "max": 10,
          "step": 0.5,
          "unit": " m"
        },
        {
          "param": "drop.lookAhead",
          "label": "look ahead — left",
          "min": 0,
          "max": 60,
          "step": 1,
          "unit": " m"
        },
        {
          "param": "push.lookAhead",
          "label": "look ahead — right",
          "min": 0,
          "max": 60,
          "step": 1,
          "unit": " m"
        },
        {
          "param": "drop.samples",
          "label": "chords per eye — left",
          "min": 1,
          "max": 24,
          "step": 1
        },
        {
          "param": "push.samples",
          "label": "chords per eye — right",
          "min": 1,
          "max": 24,
          "step": 1
        }
      ]
    },
    {
      "title": "the repair",
      "controls": [
        {
          "param": "drop.pushMax",
          "label": "push limit — left",
          "min": 0,
          "max": 16,
          "step": 0.5,
          "unit": " m"
        },
        {
          "param": "push.pushMax",
          "label": "push limit — right",
          "min": 0,
          "max": 16,
          "step": 0.5,
          "unit": " m"
        },
        {
          "param": "push.pushStep",
          "label": "search step — right",
          "min": 0.1,
          "max": 2,
          "step": 0.1,
          "unit": " m"
        },
        {
          "param": "push.pushClearance",
          "label": "clearance — right",
          "min": 0,
          "max": 5,
          "step": 0.25,
          "unit": " m"
        }
      ]
    }
  ]
}
`;export{e as default};