# NODES 2026 Demo

A browser app for exploring a Neo4j graph. The schema is on the left; the data you pick from it is on the right.
Built with [NVL](https://neo4j.com/docs/nvl/current/) (Neo4j Visualization Library), the
[Needle](https://www.neo4j.design/) design system, React and TypeScript.

## Requirements

- Node.js 20.19 or later
- A Neo4j 5.23+ database (local or Aura). The app only reads from it.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in your connection details
npm start              # http://localhost:3001
```

Without a `.env`, the app connects to `bolt://localhost:7687` as `neo4j` / `password`.

### Configuration

| Variable         | Description                                         | Default                 |
| ---------------- | --------------------------------------------------- | ----------------------- |
| `NEO4J_URI`      | e.g. `neo4j+s://<dbid>.databases.neo4j.io` for Aura | `bolt://localhost:7687` |
| `NEO4J_USERNAME` | Database user                                       | `neo4j`                 |
| `NEO4J_PASSWORD` | Database password                                   | `password`              |
| `NEO4J_DATABASE` | Database name                                       | `neo4j`                 |

Set them in `.env` or in your shell (the shell wins). They are the same names the
[Neo4j agent skills](https://github.com/neo4j-contrib/neo4j-skills) use.

> **The values are compiled into the JavaScript bundle**, password included. Always use a read-only database
> user, and restart `npm start` or rebuild after changing them.

## Using the app

- **Schema (left):** each node is a label, each arrow a relationship pattern.
  - Click a **label** to add its nodes to the scene, or remove them again.
  - Click a **relationship** to add that pattern. While it is selected, every relationship of that pattern
    between the nodes on screen is shown, and kept up to date as nodes come and go.
  - Drag the **ring** around a selected label to choose which slice of its nodes is loaded.
- **Data (right):**
  - Double-click a node to show its neighbours; double-click again to collapse them.
  - **Scribble mode** (`S`): cross out nodes or relationships to dismiss them, or draw a line between two nodes
    to load the shortest path. `S` applies, `Backspace` undoes a stroke, `Escape` cancels.
  - **History** shows a snapshot of every change; pick one to go back to it.
  - **Clear** empties the scene.

## Scripts

| Command          | What it does                                |
| ---------------- | ------------------------------------------- |
| `npm start`      | Dev server on port 3001                     |
| `npm run build`  | Production build into `dist/`               |
| `npm test`       | Unit tests (Vitest)                         |
| `npm run check`  | Typecheck, lint, formatting check and tests |
| `npm run format` | Format everything with Prettier             |

## Project structure

```
src/
  index.tsx, App.tsx   entry point and main component
  components/          React components (graph pane, schema stats overlay, history)
  hooks/               React hooks (history, scribbling)
  data/                Neo4j queries and pure scene logic
  interactions/        pan, zoom and scribble handling for NVL
  utils/               formatting and snapshot images
```
