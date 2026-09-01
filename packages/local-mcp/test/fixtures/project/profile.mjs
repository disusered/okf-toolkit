/**
 * A fixture validation profile. It emits one diagnostic no other rule can produce, so a test
 * can tell "the profile ran" apart from "the analysis happened to warn".
 */
export const profile = {
  id: "okf-mcp-fixture-profile",
  validate(context) {
    return [
      {
        code: "fixture.profile.loaded",
        severity: "warning",
        path: "index.md",
        message: `fixture profile ran over ${String(context.documents.length)} documents for today=${String(context.today)}`,
      },
    ];
  },
};
