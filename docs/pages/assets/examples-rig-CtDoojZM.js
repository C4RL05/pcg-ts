var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",
  "sections": [
    {
      "title": "spine",
      "controls": [
        { "param": "spineLine.start", "label": "from" },
        { "param": "spineLine.end", "label": "to" },
        { "param": "spineSpine.count", "label": "samples", "min": 40, "max": 300, "step": 10 },
        { "param": "spineWander.verticalAmplitude", "label": "wander up", "min": 0, "max": 8, "step": 0.1 },
        {
          "param": "spineWander.horizontalAmplitude",
          "label": "wander across",
          "min": 0,
          "max": 12,
          "step": 0.1
        },
        {
          "param": "spineWander.wanderScale",
          "label": "wander scale",
          "min": 0.1,
          "max": 8,
          "step": 0.1
        }
      ]
    },
    {
      "title": "truss",
      "controls": [
        { "param": "trussCells.count", "label": "stations", "min": 8, "max": 120, "step": 2 },
        {
          "param": "trussChordSkin.radius",
          "label": "chord",
          "min": 0.01,
          "max": 0.2,
          "step": 0.005
        },
        {
          "param": "trussBraceSkin.radius",
          "also": ["trussFrameSkin.radius"],
          "label": "brace",
          "min": 0.005,
          "max": 0.12,
          "step": 0.005
        }
      ]
    },
    {
      "title": "components",
      "controls": [
        { "param": "partDense.count", "label": "density", "min": 100, "max": 2000, "step": 50 },
        { "param": "partCluster.threshold", "label": "cluster cut", "min": 0, "max": 1, "step": 0.01 },
        { "param": "partScatter.amount", "label": "scatter" }
      ]
    },
    {
      "title": "cables",
      "controls": [
        { "param": "wrapCarrierLine.count", "label": "wraps", "min": 1, "max": 40, "step": 1 },
        { "param": "wrapCells.count", "label": "wrap steps", "min": 20, "max": 400, "step": 10 },
        {
          "param": "wrapWraps.cableRadius",
          "also": ["danglerDanglerSkin.radius", "drapeDrapeSkin.radius"],
          "label": "cable radius",
          "min": 0.005,
          "max": 0.2,
          "step": 0.005
        },
        { "param": "chainAnchors.count", "label": "chains", "min": 2, "max": 20, "step": 1 },
        { "param": "danglerAnchors.count", "label": "danglers", "min": 10, "max": 400, "step": 10 }
      ]
    },
    {
      "title": "swags",
      "controls": [
        { "param": "drapeDrapeAnchors.count", "label": "anchors", "min": 4, "max": 120, "step": 2 },
        { "param": "drapeChords.mode", "label": "pairing" },
        { "param": "drapeChords.radius", "label": "reach", "min": 1, "max": 30, "step": 0.5 },
        { "param": "drapeDrapeEven.count", "label": "segments", "min": 4, "max": 64, "step": 1 },
        { "param": "drapeLong.value", "label": "min length", "min": 0, "max": 20, "step": 0.25 },
        { "param": "drapeSome.value", "label": "keep", "min": 0, "max": 1, "step": 0.02 }
      ]
    }
  ]
}
`;export{e as default};