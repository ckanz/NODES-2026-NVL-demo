import HtmlWebpackPlugin from "html-webpack-plugin";
import webpack from "webpack";

// Optional git-ignored .env file. Variables set in the shell win.
try {
  process.loadEnvFile();
} catch {
  // No .env: use the shell environment or the defaults in src/data/neo4j.ts.
}

export default {
  entry: "./src/index.tsx",
  resolve: { extensions: [".tsx", ".ts", ".js"] },
  module: {
    rules: [
      { test: /\.tsx?$/, loader: "ts-loader" },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
      // Needle's stylesheet references its bundled fonts.
      { test: /\.woff2?$/, type: "asset/resource" },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({ template: "./public/index.html" }),
    // Read at build time and visible in the bundle: use a read-only database user.
    new webpack.EnvironmentPlugin({
      NEO4J_URI: null,
      NEO4J_USERNAME: null,
      NEO4J_PASSWORD: null,
      NEO4J_DATABASE: null,
    }),
  ],
  devServer: { port: 3001 },
};
