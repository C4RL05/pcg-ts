var e=`{\r
  "formatVersion": 1,\r
  "seed": 2207,\r
  "meta": {\r
    "title": "measure distance since the last gate, and to the next one, around a closed lap",\r
    "description": "\`pathScan\` accumulates from a path's seam and never resets, which answers 'how much lies behind me' and nothing else. The questions a marker rule actually asks are 'how far since the last gate' and 'how far to the next one', and neither is a prefix sum: getting the first out of a scan means subtracting the scan value at the most recent gate behind you, and OBTAINING that value is a backward look-up along the path. A field cannot perform one — a field resolves each element from that element alone — and \`pathScan\` was the library's only order-aware node, so there was nothing to build the emulation out of. \`pathRuns\` is the missing primitive: a SEGMENTED scan, where the accumulator resets at points a boolean attribute flags.\\n\\nIt accumulates a VALUE rather than counting elements, which is the whole ergonomic difference. Scan a per-segment length and you get distance; scan a constant 1 and you get the number of points; scan a cost and you get cost. Here \`seg\` is the lap length over the sample count — \`pathResample\` in \`count\` mode spaces its samples evenly, so one number describes every segment — brought back from the primitive domain by \`promoteAttribute\`, the same way \`basics-density-along-a-path\` recovers its scan total.\\n\\nThe gates are picked with arithmetic on \`index\` — every sixtieth sample of the 240, offset by thirty — which is exact where a threshold on \`curveU\` would not be: \`mod(index + 30, 60) < 0.5\` selects four samples and cannot select a fifth by rounding, where \`fract(curveU * 4)\` near zero can read 0.9999 instead and drop a gate. The offset is the point of the exercise. Without it the first gate would land on sample zero, which is the seam, and the graph would demonstrate nothing: gates at the seam make wrapping a no-op. \`index\` names a SLOT rather than an element and anything that filters or reorders upstream renumbers it, which is safe here because it is read immediately after the resample that creates the samples.\\n\\nWHAT THE CLOSED LAP IS DOING HERE, because it is the case the primitive exists for. Sample zero sits thirty samples PAST the last gate, on the far side of the start/finish line from it. With \`wrap\` on, the walk starts at the first flagged point rather than at vertex zero, so that run stays ONE run and sample zero reads the distance back to the gate behind it — about a quarter of the way into its run rather than at its start. Turn \`wrap\` off and the seam cuts the run in two: sample zero reads zero, and the thirty samples after it read a distance measured from the SEAM rather than from their gate, wrong by however far back the gate is. Nothing about the column shows it — the values are all still positive and still increasing, and the ramp simply restarts at a place no gate stands. A real circuit always has a corner that straddles the line.\\n\\nBoth directions are cooked because they are different questions rather than one question reversed. \`since\` reads backward-looking (what is behind me since the last gate) and \`ahead\` reads forward-looking (what is in front of me up to the next one); recovering either from the other needs each run's total, which no point holds. The colour ramps from \`since\` over a quarter-lap, so each run climbs from blue at its gate to red just before the next, and the ramp is continuous across the seam — that continuity is the whole picture. The second output is the four gate points themselves, filtered on the same flag, so the ramp can be read against where it is supposed to reset.",\r
    "tags": ["basics", "path", "runs", "segmented-scan", "closed"]\r
  },\r
  "nodes": [\r
    {\r
      "id": "ring",\r
      "type": "subgraph",\r
      "params": { "count": 40, "size": [30, 30, 10] },\r
      "ref": { "name": "shape/ring" }\r
    },\r
    {\r
      "id": "path",\r
      "type": "pointsToPath",\r
      "params": { "closed": true }\r
    },\r
    {\r
      "id": "curve",\r
      "type": "pathResample",\r
      "params": { "mode": "count", "count": 240, "lengthAttr": "lapLength" }\r
    },\r
    {\r
      "id": "len",\r
      "type": "promoteAttribute",\r
      "params": { "name": "lapLength", "from": "primitive", "to": "point", "mode": "average" }\r
    },\r
    {\r
      "id": "seg",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "seg",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "div",\r
          "args": [{ "fn": "attribute", "name": "lapLength" }, 240]\r
        }\r
      }\r
    },\r
    {\r
      "id": "gate",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "gate",\r
        "tupleSize": 1,\r
        "value": {\r
          "fn": "lt",\r
          "args": [\r
            {\r
              "fn": "mod",\r
              "args": [{ "fn": "add", "args": [{ "fn": "index" }, 30] }, 60]\r
            },\r
            0.5\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "since",\r
      "type": "pathRuns",\r
      "params": {\r
        "name": "seg",\r
        "boundary": "gate",\r
        "outName": "since",\r
        "mode": "exclusive",\r
        "direction": "forward",\r
        "wrap": true\r
      }\r
    },\r
    {\r
      "id": "ahead",\r
      "type": "pathRuns",\r
      "params": {\r
        "name": "seg",\r
        "boundary": "gate",\r
        "outName": "ahead",\r
        "mode": "exclusive",\r
        "direction": "backward",\r
        "wrap": true\r
      }\r
    },\r
    {\r
      "id": "tint",\r
      "type": "setAttribute",\r
      "params": {\r
        "name": "color",\r
        "tupleSize": 3,\r
        "value": {\r
          "fn": "vec",\r
          "args": [\r
            {\r
              "fn": "div",\r
              "args": [\r
                { "fn": "attribute", "name": "since" },\r
                { "fn": "div", "args": [{ "fn": "attribute", "name": "lapLength" }, 4] }\r
              ]\r
            },\r
            0.25,\r
            {\r
              "fn": "sub",\r
              "args": [\r
                1,\r
                {\r
                  "fn": "div",\r
                  "args": [\r
                    { "fn": "attribute", "name": "since" },\r
                    { "fn": "div", "args": [{ "fn": "attribute", "name": "lapLength" }, 4] }\r
                  ]\r
                }\r
              ]\r
            }\r
          ]\r
        }\r
      }\r
    },\r
    {\r
      "id": "gates",\r
      "type": "filterByAttribute",\r
      "params": { "attribute": "gate", "comparison": "gt", "value": 0.5 }\r
    }\r
  ],\r
  "connections": [\r
    { "from": ["ring", "out"], "to": ["path", "in"] },\r
    { "from": ["path", "out"], "to": ["curve", "in"] },\r
    { "from": ["curve", "out"], "to": ["len", "in"] },\r
    { "from": ["len", "out"], "to": ["seg", "in"] },\r
    { "from": ["seg", "out"], "to": ["gate", "in"] },\r
    { "from": ["gate", "out"], "to": ["since", "in"] },\r
    { "from": ["since", "out"], "to": ["ahead", "in"] },\r
    { "from": ["ahead", "out"], "to": ["tint", "in"] },\r
    { "from": ["tint", "out"], "to": ["gates", "in"] }\r
  ],\r
  "outputs": [\r
    { "id": "tint", "pin": "out", "name": "lap" },\r
    { "id": "gates", "pin": "out", "name": "gates" }\r
  ]\r
}\r
`;export{e as default};