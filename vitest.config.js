export default {
  test: {
    // Executa os testes-fonte; dist contém cópias geradas pelo Babel.
    include: ["src/tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.js"],
      exclude: ["src/tests/**"],
      reporter: ["text", "json", "html", "clover"],
    },
  },
};
