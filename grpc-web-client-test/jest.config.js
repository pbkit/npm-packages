module.exports = {
  coverageDirectory: "coverage",
  moduleNameMapper: {},
  resolver: require.resolve(`jest-pnp-resolver`),
  setupFilesAfterEnv: [],
  testMatch: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[tj]s?(x)"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  transformIgnorePatterns: ["/node_modules/", "\\.pnp\\.[^\\/]+$"],
};
