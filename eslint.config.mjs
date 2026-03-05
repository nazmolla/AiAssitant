import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextCoreWebVitals,
  {
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Disable React Compiler rules — existing code patterns are valid but
      // trip the compiler's strict memoization and purity checks.
      "react-compiler/react-compiler": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      // Disable setState-in-effect — pre-existing patterns (e.g. reading
      // localStorage on mount) intentionally set state inside effects.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
