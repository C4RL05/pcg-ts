var e=`{
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See examples/shared/graphUi.ts.",
  "sections": [
    {
      "title": "spine",
      "controls": [
        { "param": "spineLine.start", "label": "from" },
        { "param": "spineLine.end", "label": "to" },
        { "param": "spineSpine.count", "label": "samples", "min": 40, "max": 300, "step": 10 }
      ]
    },
    {
      "title": "truss",
      "controls": [
        { "param": "trussCells.count", "label": "stations", "min": 8, "max": 120, "step": 2 },
        {
          "param": "trussSolid0.radius",
          "also": [
            "trussSolid0.extend",
            "trussSolid2.radius",
            "trussSolid2.extend",
            "trussSolid4.radius",
            "trussSolid4.extend",
            "trussSolid6.radius",
            "trussSolid6.extend"
          ],
          "label": "chord",
          "min": 0.01,
          "max": 0.2,
          "step": 0.005
        },
        {
          "param": "trussSolid1.radius",
          "also": [
            "trussSolid1.extend",
            "trussSolid3.radius",
            "trussSolid3.extend",
            "trussSolid5.radius",
            "trussSolid5.extend",
            "trussSolid7.radius",
            "trussSolid7.extend",
            "trussSolid.radius",
            "trussSolid.extend"
          ],
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
          "also": ["danglerDanglerTube.radius", "drapeDrapeTube.radius"],
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