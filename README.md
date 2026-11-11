# NODES 2026 Demo

This repository contains the code for a project created and presented as part of a NODES 2026 conference talk.

It is a browser app for exploring a Neo4j graph. The graph schema is shown on the left. Clicking nodes and relationships in the schema will display the records on the right.
Built with [NVL](https://neo4j.com/docs/nvl/current/) (Neo4j Visualization Library), the [Needle](https://www.neo4j.design/) design system, React and TypeScript.

## Prerequisites

Have a Neo4j instance running. You can find examples graph and how to set them up on https://github.com/neo4j-graph-examples.

## Getting started

```bash
npm install
cp .env.example .env   # then fill in your connection details
npm start              # http://localhost:3001
```

Without a `.env`, the app connects to `bolt://localhost:7687` as `neo4j` / `password`.

> **The values are compiled into the JavaScript bundle, password included!** This project is only intended for local demos.

## Using the app

- **Schema (left):** each node is a label, each relationship a type of the graph.
  - Click a **label** to add its nodes to the scene, or remove them again (1k nodes query limit).
  - Click a **relationship** to add that pattern to the scene (1k record query limit).
  - Drag and expand the arc **ring** around a selected label to choose which "slice" of its nodes is loaded.
- **Data (right):**
  - **Scribble mode** (`S`): cross out nodes or relationships to dismiss them, or draw a line between two nodes
    to load the shortest path. `S` applies, `Backspace` undoes a stroke, `Escape` cancels.
  - **History** shows a snapshot of every change; pick one to go back to it.
  - **Clear** empties the scene.
  - Double-click a node to show its neighbours; double-click again to collapse them.
 
![img](https://github.com/ckanz/NODES-2026-demo/blob/main/Screenshot.png?raw=true)
