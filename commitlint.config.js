module.exports = {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message) => message.startsWith("merge: ")],
  rules: {
    // Allow sentence-case subjects so Dependabot commits
    // ("bump X from Y to Z") pass validation.
    "subject-case": [2, "never", ["upper-case", "start-case", "pascal-case"]],
  },
};
