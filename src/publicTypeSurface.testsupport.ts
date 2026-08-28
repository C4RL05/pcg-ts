/**
 * Reading an entry point's surface from the TYPE CHECKER.
 *
 * ITS OWN FILE SO THAT IMPORTING IT IS A CHOICE. `publicSurface.testsupport.ts`
 * is imported by three fast tests that read `Object.keys` and finish in
 * milliseconds; this pulls in the TypeScript compiler and builds a program,
 * which is seconds. Putting the two together would make every value test pay
 * for a compiler none of them uses, and hiding the cost behind a lazy
 * `require` inside an ESM module works only because the test runner happens
 * to transform it. A second file costs nothing and is honest about the
 * dependency.
 */
import ts from "typescript";

/** What {@link entryPointSurface} found, split by what survives erasure. */
export interface EntryPointSurface {
  /** Names that exist at runtime: const, function, class, enum. */
  readonly values: readonly string[];
  /** Names that do not: interface and type alias. */
  readonly types: readonly string[];
}

/**
 * Both halves of an entry point's surface, read from the TYPE CHECKER
 * rather than from the module object.
 *
 * WHY THIS EXISTS, AND WHY THE FILE ABOVE COULD NOT DO IT. `surfaceOf`
 * reads `Object.keys`, so it sees only what survives erasure. The header
 * of this file has always said so, and used to add that a type-only
 * change "would show up as a .d.ts diff at build time". IT DOES NOT:
 * `dist/` is gitignored and untracked, so nothing about the emitted
 * typings reaches a reviewer, a diff, or CI. That sentence was the whole
 * reason the gap was thought to be covered.
 *
 * It was not covered, and the way it failed is the case worth naming.
 * `isDeviceInstanceBatch` and `getSubgraphPlumbing` were withdrawn from
 * the root; `AnyInstanceBatch` and `SubgraphPlumbing` were the parameter
 * and return type of exactly those two and of nothing else, so they were
 * left published with no public way to obtain a value of either. Every
 * assertion in `publicSurface.test.ts` still passed, because not one
 * runtime key had moved. They were found by a person reading the barrels.
 *
 * THE CHECKER AND NOT THE EMITTED `.d.ts`, deliberately. Parsing
 * `dist/index.d.ts` would measure what a consumer actually receives,
 * which is the more faithful question — but it needs a CURRENT `dist/`,
 * and this repo already records what a stale one does (see PLAN's "docs
 * chain reads dist"): the gate would pass or fail on the age of a build
 * directory rather than on the source. The checker needs no build at all.
 *
 * A SECOND REASON WAS GIVEN HERE AND IT WAS FALSE, so it is struck rather
 * than quietly removed: "tsup emits re-export chains through hashed files,
 * so the names are not all in `index.d.ts` to be read". They are. There is
 * not one `export *` in the emitted typings -- every chunk re-export is
 * enumerated by name -- so a reader COULD parse them. The stale-build
 * hazard above is the whole of the argument and is sufficient on its own.
 *
 * WHAT THIS STILL DOES NOT CATCH, and it is more than the obvious half.
 *
 * The obvious half is SHAPE: a type that stays exported and gains a field,
 * or a param that becomes optional, is a real API change and moves no name
 * here.
 *
 * The half worth naming is that THE TYPINGS CONTAIN TYPES THIS CANNOT SEE
 * AT ALL. `FieldParam` is a live example -- `type FieldParam = FieldLike`,
 * referenced by dozens of exported `*Params` interfaces and therefore
 * emitted into `dist/index.d.ts`, but never itself exported from the root.
 * A consumer cannot `import type { FieldParam }`, so it is not part of the
 * NAMED surface this pins; a consumer absolutely can depend on its shape
 * through any of those interfaces, so changing it is still breaking. This
 * gate is a pin on the names a consumer can import, not on everything the
 * typings describe.
 *
 * Both halves need the same thing: a signature report, which is a bigger
 * tool and a bigger commitment than a name list -- worth it once the
 * package is stable and consumers are pinned to versions, and churn
 * without a payoff before then.
 */
export function entryPointSurface(entry: string, tsconfig: string): EntryPointSurface {
  const cfgFile = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (cfgFile.error !== undefined) {
    throw new Error(
      `entryPointSurface: cannot read ${tsconfig}: ${ts.flattenDiagnosticMessageText(cfgFile.error.messageText, " ")}`,
    );
  }
  const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, process.cwd());
  const program = ts.createProgram([entry], { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  const source = program.getSourceFile(entry);
  if (source === undefined) {
    throw new Error(
      `entryPointSurface: ${entry} is not in the program. Pass a path that tsconfig's "include" covers.`,
    );
  }
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) {
    throw new Error(
      `entryPointSurface: ${entry} has no module symbol, which means it exports nothing at all.`,
    );
  }

  // An `export *` re-export arrives as an Alias; the flags that say what
  // the name IS live on what it points at, so follow it first. Everything
  // else is read directly.
  // `Class` AND `Enum` ARE IN BOTH SETS, WHICH IS NOT A TYPO. A class
  // declaration introduces a type and a value under one name -- `Graph` is
  // both `new Graph()` and `let g: Graph` -- and an enum does the same.
  // The first version of this listed them as values only, so all fourteen
  // of this entry point's classes were missing from the type pin while a
  // test below asserted that no name was ever both. That test passed
  // BECAUSE the classification was wrong, which is the failure it existed
  // to catch, one level down.
  const TYPE_FLAGS =
    ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum;
  const VALUE_FLAGS =
    ts.SymbolFlags.Variable | ts.SymbolFlags.Function | ts.SymbolFlags.Class | ts.SymbolFlags.Enum;

  const values: string[] = [];
  const types: string[] = [];
  const unclassified: string[] = [];
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const flags =
      (symbol.getFlags() & ts.SymbolFlags.Alias) !== 0
        ? checker.getAliasedSymbol(symbol).getFlags()
        : symbol.getFlags();
    const isValue = (flags & VALUE_FLAGS) !== 0;
    const isType = (flags & TYPE_FLAGS) !== 0;
    // A name that is both lands in BOTH lists rather than in whichever
    // branch was tested first. Fourteen do.
    if (isValue) values.push(symbol.getName());
    if (isType) types.push(symbol.getName());
    if (!isValue && !isType) unclassified.push(`${symbol.getName()} (flags ${flags})`);
  }
  if (unclassified.length > 0) {
    throw new Error(
      `entryPointSurface: ${unclassified.length} export(s) are neither a value nor a type: ${unclassified.join(", ")}. ` +
        `A new SymbolFlags case has appeared — widen TYPE_FLAGS or VALUE_FLAGS rather than letting it fall out of both lists, ` +
        `which is how a name escapes the pin.`,
    );
  }
  return { values: values.sort(), types: types.sort() };
}
