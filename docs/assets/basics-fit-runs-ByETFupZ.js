var e=`{\r
  "_comment": "Panel spec — presentation only; the graph cooks identically without it. See shared/graphUi.ts.",\r
  "sections": [\r
    {\r
      "title": "what counts as one run",\r
      "controls": [\r
        {\r
          "param": "fit.gap",\r
          "label": "gap",\r
          "description": "The along-arc distance that separates runs, and the only number that decides which posts belong together. Past 46.23 — the empty stretch between the rows — all five merge into ONE run whose residual is the worst post anywhere on the lap. It stops at 1 because the props are 0.87 apart: below that every post becomes its own run, and the re-threading at the end fails on a group of one.",\r
          "min": 1,\r
          "max": 60,\r
          "step": 0.5\r
        },\r
        {\r
          "param": "fit.wrap",\r
          "label": "a run may cross the seam",\r
          "description": "One row is laid across the start/finish line. On, it stays one run of twenty. Off, it becomes two runs of ten whose slopes agree to five digits at 0.34397 and whose residuals are 0.00016 and 0.00015 — four decimal places under any threshold a rule would use, so nothing in the columns says the row was cut."\r
        }\r
      ]\r
    }\r
  ]\r
}\r
`;export{e as default};