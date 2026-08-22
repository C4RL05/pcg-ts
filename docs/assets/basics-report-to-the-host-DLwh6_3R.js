var e=`{
  "formatVersion": 1,
  "seed": 1060,
  "meta": {
    "title": "what a graph hands back that is not geometry",
    "description": "A cook returns items, and only some of them are shapes. This graph returns three kinds at once and the difference between them is the lesson.\\n\\n\`attributeReduce\` collapses a whole domain into ONE value on the DETAIL domain: the sum of the weights, their maximum, and a plain count of the points. Three reductions of one attribute need three distinct \`outName\`s — left empty the name is reused, which is what promoting would have produced and is fine for one. Mode 'count' reads no attribute at all, so \`name\` is left empty there rather than pointing at a column it will ignore. THE CONSTRAINT WORTH KNOWING: a point-domain field cannot read the detail domain. That is deliberate, not an oversight — a field resolves each element from that element alone, and a total is a property of every element at once, so a graph cannot feed its own totals back into its own points. Anything that needs to (calibrate a count against a budget, normalize by a maximum) runs as a loop in the HOST, between cooks, reading these reports and setting params for the next one.\\n\\n\`removeAttribute\` is the other half. \`weight\` here is scratch — it exists to be reduced — and every idiom that carries a value between nodes leaves its column on the output forever unless something takes it off. This is the only node that can, and the ORDER is the point: the reductions read the column, so they must run before the removal. It is \`strict\` by default, so a typo in the name is an error naming the columns that do exist rather than a silent no-op leaving exactly the debris it was meant to clear.\\n\\n\`valueConstant\` is the third kind: a plain number, riding back beside the geometry. Here it is the weight budget the graph was authored against, for a host to compare the reduced \`weightSum\` against — and as it stands this cook comes out OVER it, which is the interesting case: the comparison is a signal a host loop acts on by changing a param and cooking again, not an assertion the graph makes about itself — a number the graph declares rather than derives, which is why it is a constant and not another reduction. Worth knowing before reaching for it: EVERY input pin in this library is geometry-kind, so a value item has nowhere to go inside a graph. Its only destination is an output.",
    "tags": ["basics", "attributes", "reduce", "detail", "values"]
  },
  "nodes": [
    {
      "id": "grid",
      "type": "pointGrid",
      "params": { "countX": 41, "countZ": 41, "spacing": [0.5, 1, 0.5], "origin": [-10, 0, -10] }
    },
    {
      "id": "weight",
      "type": "setAttribute",
      "params": {
        "name": "weight",
        "domain": "point",
        "type": "f32",
        "tupleSize": 1,
        "value": {
          "fn": "sub",
          "args": [
            1,
            {
              "fn": "clamp",
              "args": [
                {
                  "fn": "div",
                  "args": [
                    {
                      "fn": "distance",
                      "args": [
                        { "fn": "position" },
                        { "fn": "vec", "args": [0, 0, 0] }
                      ]
                    },
                    12
                  ]
                },
                0,
                1
              ]
            }
          ]
        }
      }
    },
    {
      "id": "total",
      "type": "attributeReduce",
      "params": { "name": "weight", "domain": "point", "mode": "sum", "outName": "weightSum" }
    },
    {
      "id": "peak",
      "type": "attributeReduce",
      "params": { "name": "weight", "domain": "point", "mode": "max", "outName": "weightMax" }
    },
    {
      "id": "tally",
      "type": "attributeReduce",
      "params": { "name": "", "domain": "point", "mode": "count", "outName": "pointCount" }
    },
    {
      "id": "clean",
      "type": "removeAttribute",
      "params": { "names": ["weight"], "domain": "point", "strict": true }
    },
    {
      "id": "budget",
      "type": "valueConstant",
      "params": { "value": 500 }
    }
  ],
  "connections": [
    { "from": ["grid", "out"], "to": ["weight", "in"] },
    { "from": ["weight", "out"], "to": ["total", "in"] },
    { "from": ["total", "out"], "to": ["peak", "in"] },
    { "from": ["peak", "out"], "to": ["tally", "in"] },
    { "from": ["tally", "out"], "to": ["clean", "in"] }
  ],
  "outputs": [
    { "id": "clean", "pin": "out", "name": "points" },
    { "id": "budget", "pin": "out", "name": "weightBudget" }
  ]
}
`;export{e as default};